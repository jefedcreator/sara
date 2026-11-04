import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import type {
  AssistantAction,
  AssistantConversation,
  AssistantTurn,
} from "@prisma/client";

import { db } from "@/server/db";
import type {
  ActionResult,
  AssistantReply,
  DraftDto,
  DraftStatus,
  ResourceKind,
} from "types/assistant";

import type {
  AssistantScope,
  SaveTurnInput,
  StoredToolRecord,
  StoredTurn,
} from "./types";

export type {
  AssistantScope,
  SaveTurnInput,
  StoredToolRecord,
  StoredTurn,
};

/** A live lease is longer than the 25-second model deadline plus cleanup. */
const LEASE_MS = 30_000;
const RECENT_MS = 30 * 60 * 1000;
const MAX_RECENT_TURNS = 12;
const MAX_HISTORY_CHARS = 16_000;

export const INTERRUPTED_TURN_REPLY =
  "That request was interrupted. Please send it again as a new message.";

const draftStatuses: ReadonlySet<string> = new Set<string>([
  "PENDING",
  "APPROVED",
  "CANCELLED",
  "EXPIRED",
  "REPLACED",
  "INVALID",
] satisfies DraftStatus[]);

const resourceKinds: ReadonlySet<string> = new Set<string>([
  "invoices",
  "receipts",
  "orders",
  "products",
  "services",
  "bookings",
  "customers",
  "dashboard",
] satisfies ResourceKind[]);

function isDraftStatus(value: string): value is DraftStatus {
  return draftStatuses.has(value);
}

function isResourceKind(value: string): value is ResourceKind {
  return resourceKinds.has(value);
}

function storeError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDraft(value: unknown): DraftDto | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.expiresAt !== "string" ||
    typeof value.status !== "string" ||
    !isDraftStatus(value.status)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    summary: value.summary,
    expiresAt: value.expiresAt,
    status: value.status,
  };
}

function parseActionResult(
  value: unknown,
): ActionResult | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  if (
    typeof value.text !== "string" ||
    typeof value.resourceId !== "string" ||
    (value.link !== null && typeof value.link !== "string") ||
    !Array.isArray(value.affected)
  ) {
    return undefined;
  }
  const affected: ResourceKind[] = [];
  const rawAffected: unknown[] = value.affected;
  for (const kind of rawAffected) {
    if (typeof kind !== "string" || !isResourceKind(kind)) return undefined;
    affected.push(kind);
  }
  return {
    text: value.text,
    resourceId: value.resourceId,
    link: value.link,
    affected,
  };
}

type ParsedReply = {
  text: string;
  draft: DraftDto | null;
  result: ActionResult | null;
};

/**
 * `reply` is JSON on purpose: it lets a duplicate request replay the exact
 * reply, including the draft and the saved action result, without a new model
 * call. Older/plain rows may contain just a JSON string.
 */
function parseReply(value: Prisma.JsonValue | null): ParsedReply | null {
  if (typeof value === "string") {
    return { text: value, draft: null, result: null };
  }
  if (!isRecord(value) || typeof value.text !== "string") return null;
  const draft = parseDraft(value.draft);
  const result = parseActionResult(value.result);
  if (draft === undefined || result === undefined) return null;
  return { text: value.text, draft, result };
}

function parseToolRecords(
  value: Prisma.JsonValue,
): StoredToolRecord[] | null {
  if (!Array.isArray(value)) return null;
  const records: StoredToolRecord[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.name !== "string" ||
      !("arguments" in item) ||
      !("output" in item)
    ) {
      return null;
    }
    records.push({
      name: item.name,
      arguments: item.arguments as Prisma.JsonValue,
      output: item.output as Prisma.JsonValue,
    });
  }
  return records;
}

function storedTurn(row: AssistantTurn): StoredTurn | null {
  const reply = parseReply(row.reply);
  const toolRecords = parseToolRecords(row.toolRecords);
  if (!reply || !toolRecords) return null;
  return {
    userText: row.userText,
    transcript: row.transcript,
    reply: reply.text,
    toolRecords,
    createdAt: row.createdAt,
  };
}

function withinHistoryBounds(turns: StoredTurn[]): StoredTurn[] {
  const recent = turns.slice(-MAX_RECENT_TURNS);
  let chars = 0;
  let start = recent.length;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const turn = recent[index];
    if (!turn) break;
    const size =
      turn.userText.length +
      (turn.transcript?.length ?? 0) +
      turn.reply.length +
      JSON.stringify(turn.toolRecords).length;
    if (chars + size > MAX_HISTORY_CHARS) break;
    chars += size;
    start = index;
  }
  return recent.slice(start);
}

/**
 * Get (or atomically create) the one conversation for this trusted scope.
 * The database unique key is the scope's real boundary.
 */
export async function getConversation(
  scope: AssistantScope,
): Promise<AssistantConversation> {
  return db.assistantConversation.upsert({
    where: {
      businessId_channel_principalId: {
        businessId: scope.businessId,
        channel: scope.channel,
        principalId: scope.principalId,
      },
    },
    create: {
      businessId: scope.businessId,
      channel: scope.channel,
      principalId: scope.principalId,
    },
    update: {},
  });
}

/** Load a conversation only when every scoped identifier matches. */
export async function assertConversation(
  scope: AssistantScope,
  id: string,
): Promise<AssistantConversation> {
  const conversation = await db.assistantConversation.findFirst({
    where: {
      id,
      businessId: scope.businessId,
      channel: scope.channel,
      principalId: scope.principalId,
    },
  });
  if (!conversation) throw storeError("CONVERSATION_NOT_FOUND");
  return conversation;
}

/** Completed turns from the active memory version and the last 30 minutes. */
export async function loadRecent(
  scope: AssistantScope,
  now: Date,
): Promise<StoredTurn[]> {
  const conversation = await getConversation(scope);
  const cutoff = new Date(now.getTime() - RECENT_MS);
  const rows = await db.assistantTurn.findMany({
    where: {
      conversationId: conversation.id,
      memoryVersion: conversation.memoryVersion,
      state: "DONE",
      createdAt: { gte: cutoff },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_RECENT_TURNS,
  });

  const recent = rows
    .slice()
    .reverse()
    .filter((row) => row.createdAt.getTime() >= cutoff.getTime())
    .map(storedTurn)
    .filter((turn): turn is StoredTurn => turn !== null);
  return withinHistoryBounds(recent);
}

/**
 * Reset conversational memory without touching a draft. The version bump is
 * what makes all older turns invisible to `loadRecent`; deleting them would
 * also destroy useful audit history.
 */
export async function resetMemory(scope: AssistantScope): Promise<void> {
  const conversation = await getConversation(scope);
  await db.assistantConversation.update({
    where: { id: conversation.id },
    data: {
      memoryVersion: { increment: 1 },
      clarification: Prisma.DbNull,
      editingActionId: null,
      lastActiveAt: new Date(),
    },
  });
}

/** One acquisition generation; never derive lease tokens from a request id. */
export type TurnLease = {
  status: "claimed";
  conversationId: string;
  leaseToken: string;
  memoryVersion: number;
};

export type TurnClaim = TurnLease | "busy" | AssistantReply;

function replay(conversationId: string, row: AssistantTurn): AssistantReply {
  const reply = parseReply(row.reply);
  if (!reply) throw storeError("ASSISTANT_TURN_CORRUPT");
  return {
    conversationId,
    requestId: row.requestId,
    transcript: row.transcript,
    reply: reply.text,
    draft: reply.draft,
    result: reply.result,
  };
}

/** Acquire a fresh generation and capture its memory version atomically. */
export async function claimTurnLease(
  scope: AssistantScope,
  requestId: string,
): Promise<TurnClaim> {
  if (requestId.startsWith("approve:")) {
    throw storeError("ASSISTANT_REQUEST_ID_RESERVED");
  }
  const conversation = await getConversation(scope);
  const key = { conversationId: conversation.id, requestId };
  const existing = await db.assistantTurn.findUnique({
    where: { conversationId_requestId: key },
  });
  if (existing?.state === "DONE") return replay(conversation.id, existing);

  return db.$transaction(async (tx) => {
    const now = new Date();
    const leaseToken = randomUUID();
    const claimed = await tx.assistantConversation.updateMany({
      where: {
        id: conversation.id,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: {
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        lastActiveAt: now,
      },
    });
    if (claimed.count !== 1) return "busy";

    // The conditional update holds the conversation row lock until commit.
    // Re-read after acquiring it: reset or another completion may have won.
    const current = await tx.assistantConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    const row = await tx.assistantTurn.findUnique({
      where: { conversationId_requestId: key },
    });
    if (row?.state === "DONE") {
      await tx.assistantConversation.update({
        where: { id: conversation.id },
        data: { leaseToken: null, leaseExpiresAt: null },
      });
      return replay(conversation.id, row);
    }
    // A prior reservation may already have paid for provider work, even when
    // its process died before writing counters or a DONE reply. Never execute
    // that request again. Recover it terminally while holding the lease lock.
    const reserved = await tx.assistantUsage.findUnique({
      where: { conversationId_requestId: key },
      select: { id: true },
    });
    if (reserved) {
      const recovered: AssistantReply = {
        conversationId: conversation.id,
        requestId,
        transcript: row?.transcript ?? null,
        reply: INTERRUPTED_TURN_REPLY,
        draft: null,
        result: null,
      };
      const reply = { text: recovered.reply, draft: null, result: null };
      await tx.assistantTurn.upsert({
        where: { conversationId_requestId: key },
        create: { ...key, memoryVersion: current.memoryVersion, reply, state: "DONE" },
        // Preserve the old memory version across a reset and all known inputs.
        update: { reply, state: "DONE" },
      });
      await tx.assistantConversation.update({
        where: { id: conversation.id },
        data: { leaseToken: null, leaseExpiresAt: null },
      });
      // Do not modify usage: the original execution may still finalize known
      // counters late. There is only ever one paid attempt for this key.
      return recovered;
    }
    await tx.assistantTurn.upsert({
      where: { conversationId_requestId: key },
      create: { ...key, memoryVersion: current.memoryVersion },
      update: {
        state: "RUNNING",
        memoryVersion: current.memoryVersion,
        reply: Prisma.DbNull,
        toolRecords: [],
      },
    });
    return {
      status: "claimed" as const,
      conversationId: conversation.id,
      leaseToken,
      memoryVersion: current.memoryVersion,
    };
  });
}

/** Compatibility seam. New turn runners must keep the claimTurnLease result. */
export async function claimTurn(
  scope: AssistantScope,
  requestId: string,
): Promise<"claimed" | "busy" | AssistantReply> {
  const result = await claimTurnLease(scope, requestId);
  return typeof result === "object" && "status" in result ? "claimed" : result;
}

/** Clear exactly this acquisition, including when the same request is retried. */
export async function releaseTurn(
  scope: AssistantScope,
  requestId: string,
  leaseToken: string,
): Promise<void> {
  void requestId;
  const conversation = await getConversation(scope);
  await db.assistantConversation.updateMany({
    where: { id: conversation.id, leaseToken },
    data: { leaseToken: null, leaseExpiresAt: null },
  });
}

/**
 * Save only under the live acquisition and original memory version. DONE rows
 * are durable idempotency records; history bounds are applied only on reads.
 */
export async function saveTurn(
  scope: AssistantScope,
  requestId: string,
  turn: SaveTurnInput,
): Promise<void> {
  const conversation = await getConversation(scope);
  if (!turn.leaseToken || turn.memoryVersion === undefined) {
    throw storeError("ASSISTANT_LEASE_REQUIRED");
  }
  const fullReply = typeof turn.reply === "string" ? null : turn.reply;
  const text = typeof turn.reply === "string" ? turn.reply : turn.reply.reply;
  const transcript = turn.transcript !== undefined
    ? turn.transcript : (fullReply?.transcript ?? null);
  const draft = turn.draft !== undefined ? turn.draft : (fullReply?.draft ?? null);
  const result = turn.result !== undefined ? turn.result : (fullReply?.result ?? null);
  const memoryVersion = turn.memoryVersion;
  const leaseToken = turn.leaseToken;
  await db.$transaction(async (tx) => {
    const now = new Date();
    const current = await tx.assistantConversation.updateMany({
      where: {
        id: conversation.id,
        leaseToken,
        memoryVersion,
        leaseExpiresAt: { gt: now },
      },
      data: { lastActiveAt: now },
    });
    if (current.count !== 1) throw storeError("ASSISTANT_TURN_STALE");
    const saved = await tx.assistantTurn.updateMany({
      where: {
        conversationId: conversation.id,
        requestId,
        memoryVersion,
        state: "RUNNING",
      },
      data: {
        userText: turn.userText ?? "",
        transcript,
        toolRecords: (turn.toolRecords ?? []) as unknown as Prisma.InputJsonValue,
        reply: { text, draft, result } as unknown as Prisma.InputJsonValue,
        state: turn.state ?? "DONE",
      },
    });
    if (saved.count !== 1) throw storeError("ASSISTANT_TURN_STALE");
  });
}

/** Load a draft/action only through its scoped conversation. */
export async function getAction(
  scope: AssistantScope,
  id: string,
): Promise<AssistantAction> {
  const action = await db.assistantAction.findFirst({
    where: {
      id,
      businessId: scope.businessId,
      conversation: {
        businessId: scope.businessId,
        channel: scope.channel,
        principalId: scope.principalId,
      },
    },
  });
  if (!action) throw storeError("ACTION_NOT_FOUND");
  return action;
}

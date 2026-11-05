import { Prisma, type AssistantAction } from "@prisma/client";

import { db } from "@/server/db";
import type { DraftDto } from "types/assistant";

import type { AssistantScope } from "../types";
import { renderSummary } from "./summary";
import type { PreparedAction } from "./types";

const DRAFT_LIFETIME_MS = 24 * 60 * 60 * 1_000;

/** Keep the conversationId and token returned by claimTurnLease. No bypass. */
export type DraftPublication = {
  conversationId: string;
  leaseToken: string;
  signal?: AbortSignal;
};

function error(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function dto(action: AssistantAction): DraftDto {
  return { id: action.id, summary: action.summary, expiresAt: action.expiresAt.toISOString(), status: action.status };
}
function scopedAction(scope: AssistantScope, conversationId: string) {
  return { conversationId, businessId: scope.businessId, conversation: { ...scope } };
}

/** Lock the conversation before touching lifecycle state, including approval. */
async function lockConversation(tx: Prisma.TransactionClient, scope: AssistantScope, now: Date) {
  const conversation = await tx.assistantConversation.findFirst({ where: { ...scope } });
  if (!conversation) return null;
  const locked = await tx.assistantConversation.updateMany({
    where: { id: conversation.id, ...scope },
    data: { lastActiveAt: now },
  });
  if (locked.count !== 1) throw error("CONVERSATION_NOT_FOUND");
  // A replacement or edit may have acquired the row lock before this request.
  return tx.assistantConversation.findFirst({ where: { id: conversation.id, ...scope } });
}

async function expirePending(tx: Prisma.TransactionClient, scope: AssistantScope, conversationId: string, now: Date) {
  const where = scopedAction(scope, conversationId);
  const expired = await tx.assistantAction.findMany({
    where: { ...where, status: "PENDING", expiresAt: { lte: now } },
    select: { id: true },
  });
  if (!expired.length) return;
  await tx.assistantAction.updateMany({
    where: { ...where, status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  await tx.assistantConversation.updateMany({
    where: { id: conversationId, ...scope, editingActionId: { in: expired.map((row) => row.id) } },
    data: { editingActionId: null },
  });
}

/** Store immutable code-written approval text under the current turn lease. */
export async function createDraft(
  scope: AssistantScope,
  prepared: PreparedAction,
  memoryVersion: number,
  now: Date,
  publication: DraftPublication,
): Promise<DraftDto> {
  if (!publication?.conversationId || !publication.leaseToken || !Number.isSafeInteger(memoryVersion)) {
    throw error("ASSISTANT_LEASE_REQUIRED");
  }
  // Copy before yielding: the payload used for text must be the payload stored.
  const stable = JSON.parse(JSON.stringify(prepared)) as PreparedAction;
  const originalRequest: unknown = stable.snapshot.originalRequest;
  if (stable.snapshot.businessId !== scope.businessId ||
      !isObject(originalRequest) || originalRequest.kind !== stable.kind) {
    throw error("ASSISTANT_DRAFT_UNTRUSTED");
  }
  const summary = renderSummary(stable.kind, stable.payload, stable.snapshot);
  const expiresAt = new Date(now.getTime() + DRAFT_LIFETIME_MS);
  return db.$transaction(async (tx) => {
    // Lock by scope first: a bound clock captured before this write could expire
    // while PostgreSQL waits for another lifecycle transaction to release it.
    const locked = await tx.assistantConversation.updateMany({
      where: { id: publication.conversationId, ...scope },
      data: { lastActiveAt: now },
    });
    if (locked.count !== 1) throw error("ASSISTANT_TURN_STALE");
    const current = await tx.assistantConversation.findFirst({
      where: { id: publication.conversationId, ...scope },
    });
    const publishedAt = new Date();
    publication.signal?.throwIfAborted();
    if (!current || current.memoryVersion !== memoryVersion ||
        current.leaseToken !== publication.leaseToken ||
        !current.leaseExpiresAt || current.leaseExpiresAt.getTime() <= publishedAt.getTime()) {
      throw error("ASSISTANT_TURN_STALE");
    }
    await expirePending(tx, scope, publication.conversationId, publishedAt);
    await tx.assistantAction.updateMany({
      where: { ...scopedAction(scope, publication.conversationId), status: "PENDING" },
      data: { status: "REPLACED" },
    });
    publication.signal?.throwIfAborted();
    const draft = await tx.assistantAction.create({
      data: {
        conversationId: publication.conversationId, businessId: scope.businessId,
        kind: stable.kind, payload: stable.payload, snapshot: stable.snapshot,
        summary, status: "PENDING", expiresAt,
      },
    });
    await tx.assistantConversation.update({
      where: { id: publication.conversationId },
      data: { editingActionId: null, clarification: Prisma.DbNull },
    });
    return dto(draft);
  });
}

/** An editing preview stays available as context; it cannot be approved. */
export async function getPendingDraft(scope: AssistantScope, now: Date): Promise<DraftDto | null> {
  return db.$transaction(async (tx) => {
    const conversation = await lockConversation(tx, scope, now);
    if (!conversation) return null;
    const checkedAt = new Date(Math.max(now.getTime(), Date.now()));
    await expirePending(tx, scope, conversation.id, checkedAt);
    const action = await tx.assistantAction.findFirst({
      where: { ...scopedAction(scope, conversation.id), status: "PENDING", expiresAt: { gt: checkedAt } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return action ? dto(action) : null;
  });
}

export async function changeDraft(scope: AssistantScope, actionId: string): Promise<DraftDto> {
  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    const conversation = await lockConversation(tx, scope, now);
    if (!conversation) throw error("ACTION_NOT_FOUND");
    const action = await tx.assistantAction.findFirst({
      where: { id: actionId, ...scopedAction(scope, conversation.id) },
    });
    if (!action) throw error("ACTION_NOT_FOUND");
    if (action.status !== "PENDING") throw error("ASSISTANT_DRAFT_NOT_PENDING");
    const checkedAt = new Date();
    if (action.expiresAt.getTime() <= checkedAt.getTime()) {
      await expirePending(tx, scope, conversation.id, checkedAt);
      return null;
    }
    await tx.assistantConversation.update({
      where: { id: conversation.id },
      data: { editingActionId: action.id, clarification: Prisma.DbNull },
    });
    return dto(action);
  });
  // Throw outside the transaction so expiry remains durable.
  if (!result) throw error("ASSISTANT_DRAFT_EXPIRED");
  return result;
}

export async function cancelDraft(scope: AssistantScope, actionId?: string): Promise<void> {
  const now = new Date();
  await db.$transaction(async (tx) => {
    const conversation = await lockConversation(tx, scope, now);
    if (!conversation) { if (actionId) throw error("ACTION_NOT_FOUND"); return; }
    let clearContext = !actionId;
    if (actionId) {
      const action = await tx.assistantAction.findFirst({
        where: { id: actionId, ...scopedAction(scope, conversation.id) },
      });
      if (!action) throw error("ACTION_NOT_FOUND");
      if (action.status !== "PENDING" && action.status !== "CANCELLED" && action.status !== "EXPIRED") throw error("ASSISTANT_DRAFT_NOT_PENDING");
      clearContext = action.status === "PENDING" || conversation.editingActionId === actionId;
    }
    await expirePending(tx, scope, conversation.id, new Date());
    await tx.assistantAction.updateMany({
      where: { ...scopedAction(scope, conversation.id), ...(actionId ? { id: actionId } : {}), status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (clearContext) await tx.assistantConversation.updateMany({
      where: { id: conversation.id, ...scope },
      data: { editingActionId: null, clarification: Prisma.DbNull },
    });
  });
}

/**
 * Acquires the same conversation row lock used by edits and publication.
 * The caller must re-resolve and mutate within this supplied transaction.
 * Never use getPendingDraft alone as authorization for an approval.
 */
export async function assertDraftApprovableInTransaction(
  tx: Prisma.TransactionClient,
  scope: AssistantScope,
  actionId: string,
  now: Date,
): Promise<AssistantAction> {
  const conversation = await lockConversation(tx, scope, now);
  if (!conversation) throw error("ACTION_NOT_FOUND");
  const action = await tx.assistantAction.findFirst({
    where: { id: actionId, ...scopedAction(scope, conversation.id) },
  });
  if (!action) throw error("ACTION_NOT_FOUND");
  if (action.status !== "PENDING") throw error("ASSISTANT_DRAFT_NOT_PENDING");
  // The caller's timestamp may predate a lock wait; it is only a lower bound.
  const checkedAt = new Date(Math.max(now.getTime(), Date.now()));
  if (action.expiresAt.getTime() <= checkedAt.getTime()) throw error("ASSISTANT_DRAFT_EXPIRED");
  if (conversation.editingActionId === action.id) throw error("ASSISTANT_DRAFT_EDITING");
  return action;
}

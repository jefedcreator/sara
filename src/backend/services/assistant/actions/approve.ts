import { type Prisma, type AssistantAction } from "@prisma/client";
import { z } from "zod";

import { withSerializable } from "@/backend/services/assistant/transaction";
import { HttpException } from "@/utils/exceptions";
import type { ActionResult, ApprovalReply, ResourceKind } from "@/types/assistant";

import { assistantConfig } from "../config";
import type { AssistantScope, Effect } from "../types";
import { recordApprovalUsage } from "../usage";
import { lockActionInTransaction } from "./drafts";
import { executeAction, finalizeEffects } from "./execute";
import { draftRequestSchema } from "./schemas";
import { renderSummary } from "./summary";
import type { OwnerEvidence, PreparedAction } from "./types";
import { resolveDraft } from "./resolve";

const CHANGED_EXPLANATION = "The shop's details changed since this draft was made.";
const CHANGED_REPLY = "Nothing was changed. Ask Sara again for a fresh preview.";
const RESOURCE_KINDS = new Set<ResourceKind>([
  "invoices",
  "receipts",
  "orders",
  "products",
  "services",
  "bookings",
  "customers",
  "dashboard",
]);

const ownerEvidenceSchema = z.object({
  text: z.string(),
  recentOwnerTexts: z.array(z.string()),
  selectedIds: z.array(z.string()),
});

export type ChangedAction = { changed: true; explanation: string };

function error(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function safeErrorCode(value: unknown): string {
  return typeof value === "object" && value !== null && "code" in value
    ? String((value as { code?: unknown }).code)
    : "unknown";
}

function object(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

/** Stable key order so two JSON payloads can be compared without timestamp noise. */
function canonical(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Values used to decide what the action means, beyond the displayed text.
 * Timestamps record provenance, but a harmless row touch must not invalidate a
 * preview. Invoice stock is informational: invoicing does not reserve or take it.
 */
function materialSnapshot(kind: string, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => materialSnapshot(kind, item));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !["originalRequest", "resolvedRequest", "ownerEvidence", "resolvedAt"].includes(key) &&
    !/updatedAt$/i.test(key) &&
    !(kind === "create_invoice" && ["stockBefore", "stockAfter", "physicalStock", "availableStock"].includes(key)),
  ).map(([key, item]) => [key, materialSnapshot(kind, item)]));
}

/**
 * Expected rejections mean the proposal no longer matches current data. Prisma
 * and programmer errors stay fatal so storage failures cannot invalidate drafts
 * or commit a misleading state change.
 */
function expectedInvalid(value: unknown): boolean {
  if (value instanceof HttpException || value instanceof z.ZodError) return true;
  if (typeof value !== "object" || value === null || !("code" in value)) return false;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && !code.startsWith("P");
}

function explanationFor(value: unknown): string {
  return value instanceof HttpException ? value.message : CHANGED_EXPLANATION;
}

function savedResult(value: Prisma.JsonValue | null): ActionResult {
  const saved = object(value);
  if (typeof saved.text !== "string" || typeof saved.resourceId !== "string" ||
      (saved.link !== null && typeof saved.link !== "string") ||
      !Array.isArray(saved.affected) ||
      !saved.affected.every((kind): kind is ResourceKind => typeof kind === "string" && RESOURCE_KINDS.has(kind as ResourceKind))) {
    throw error("ASSISTANT_ACTION_RESULT_MISSING");
  }
  return {
    text: saved.text,
    resourceId: saved.resourceId,
    link: saved.link,
    affected: [...saved.affected] as ResourceKind[],
  };
}

/**
 * Parse the stored request/evidence and run the same resolver used to create the
 * draft. The new payload and code-written summary must match the approved text
 * exactly; otherwise the owner would be approving different consequences.
 */
export async function revalidateAction(
  tx: Prisma.TransactionClient,
  scope: AssistantScope,
  action: AssistantAction,
  now: Date,
): Promise<PreparedAction | ChangedAction> {
  const changed = (explanation = CHANGED_EXPLANATION): ChangedAction => ({ changed: true, explanation });
  try {
    const snapshot = object(action.snapshot);
    if (snapshot.businessId !== scope.businessId) return changed();
    // The invoice request froze a relative due date when the draft was made.
    const requestValue = action.kind === "create_invoice" && snapshot.resolvedRequest
      ? snapshot.resolvedRequest
      : snapshot.originalRequest;
    const request = draftRequestSchema.parse(requestValue);
    if (request.kind !== action.kind) return changed();
    const evidence: OwnerEvidence = ownerEvidenceSchema.parse(snapshot.ownerEvidence);

    const resolved = await resolveDraft(tx, scope, request, evidence, now);
    if ("question" in resolved) return changed(resolved.question || CHANGED_EXPLANATION);
    if (resolved.kind !== action.kind) return changed();
    if (canonical(resolved.payload) !== canonical(action.payload)) return changed();
    if (canonical(materialSnapshot(action.kind, resolved.snapshot)) !==
        canonical(materialSnapshot(action.kind, action.snapshot))) return changed();

    const summary = renderSummary(resolved.kind, resolved.payload, resolved.snapshot);
    if (summary !== action.summary) return changed();
    return resolved;
  } catch (caught) {
    if (!expectedInvalid(caught)) throw caught;
    return changed(explanationFor(caught));
  }
}

function alreadyDone(action: AssistantAction): ApprovalReply {
  const result = savedResult(action.result);
  return {
    status: "already_done",
    reply: `Already done. ${result.text}`,
    result,
    draft: null,
  };
}

/** Map a non-pending action without ever executing it again. */
function existingOutcome(action: AssistantAction): ApprovalReply | null {
  switch (action.status) {
    case "APPROVED":
      return alreadyDone(action);
    case "CANCELLED":
      return { status: "cancelled", reply: "This draft was cancelled. Nothing was changed.", result: null, draft: null };
    case "EXPIRED":
    case "REPLACED":
      return { status: "expired", reply: "This draft is no longer available. Nothing was changed.", result: null, draft: null };
    case "INVALID":
      return { status: "changed", reply: `This draft is no longer valid. ${CHANGED_REPLY}`, result: null, draft: null };
    case "PENDING":
      return null;
    default:
      throw error("ASSISTANT_ACTION_UNKNOWN_STATUS");
  }
}

async function clearEditing(tx: Prisma.TransactionClient, scope: AssistantScope, conversationId: string, actionId: string) {
  await tx.assistantConversation.updateMany({
    where: {
      id: conversationId,
      businessId: scope.businessId,
      channel: scope.channel,
      principalId: scope.principalId,
      editingActionId: actionId,
    },
    data: { editingActionId: null },
  });
}

/**
 * Approve one stored draft exactly once.
 *
 * Claim, expiry/editing checks, revalidation, domain writes and the saved
 * result share one serializable transaction. Replays read that result instead
 * of executing again. Remote document/email/calendar work happens only after
 * commit and cannot turn a committed write back into a retryable mutation.
 */
export async function approveAction(
  scope: AssistantScope,
  actionId: string,
  now: Date,
): Promise<ApprovalReply> {
  if (!actionId) throw error("ACTION_NOT_FOUND");
  const config = assistantConfig();
  if (!config.enabled || !config.available) throw error("ASSISTANT_UNAVAILABLE");

  const startedAt = new Date();
  let effects: Effect[] = [];

  const outcome = await withSerializable(async (tx) => {
    effects = [];
    const { action, conversation } = await lockActionInTransaction(tx, scope, actionId, now);
    // Another approval/edit may have waited for this lock.
    const checkedAt = new Date(Math.max(now.getTime(), Date.now()));

    const existing = existingOutcome(action);
    if (existing) return existing;

    if (action.expiresAt.getTime() <= checkedAt.getTime()) {
      await tx.assistantAction.updateMany({
        where: { id: action.id, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      await clearEditing(tx, scope, conversation.id, action.id);
      return {
        status: "expired",
        reply: "This draft has expired. Nothing was changed.",
        result: null,
        draft: null,
      } satisfies ApprovalReply;
    }

    if (conversation.editingActionId === action.id) throw error("ASSISTANT_DRAFT_EDITING");

    const claimed = await tx.assistantAction.updateMany({
      where: { id: action.id, status: "PENDING", expiresAt: { gt: checkedAt } },
      data: { status: "APPROVED", approvedAt: checkedAt },
    });
    if (claimed.count !== 1) {
      const latest = await tx.assistantAction.findUniqueOrThrow({ where: { id: action.id } });
      const raced = existingOutcome(latest);
      if (raced) return raced;
      throw error("ASSISTANT_ACTION_CLAIM_LOST");
    }

    const revalidated = await revalidateAction(tx, scope, action, checkedAt);
    if ("changed" in revalidated) {
      await tx.assistantAction.update({
        where: { id: action.id },
        data: { status: "INVALID", approvedAt: null },
      });
      return {
        status: "changed",
        reply: `I didn't apply this draft. ${revalidated.explanation} ${CHANGED_REPLY}`,
        result: null,
        draft: null,
      } satisfies ApprovalReply;
    }

    const executed = await executeAction(tx, scope, revalidated, checkedAt);
    await tx.assistantAction.update({
      where: { id: action.id },
      data: { result: executed.result },
    });
    effects = executed.effects;
    return {
      status: "approved",
      reply: executed.result.text,
      result: executed.result,
      draft: null,
    } satisfies ApprovalReply;
  });

  // Approval is free: no model call and no daily paid-turn charge.
  try {
    await recordApprovalUsage(
      scope,
      actionId,
      startedAt,
      outcome.status === "approved" || outcome.status === "already_done" ? "approved" : "denied",
    );
  } catch (caught) {
    console.warn(`[Assistant] approval usage failed for ${actionId} (${safeErrorCode(caught)})`);
  }

  if (outcome.status === "approved") {
    try {
      await finalizeEffects(effects);
    } catch (caught) {
      console.warn(`[Assistant] approval effects failed for ${actionId} (${safeErrorCode(caught)})`);
    }
  }
  return outcome;
}

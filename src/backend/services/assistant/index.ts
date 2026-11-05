import { db } from "@/server/db";
import type { AssistantReply } from "types/assistant";
import { AudioError, transcribeAudio, transcriptPrefix } from "./audio";
import { assistantConfig, TURN_TIMEOUT_MS } from "./config";
import { runModelTurn, clarificationText, withinDeadline } from "./loop";
import { ERROR_REPLY } from "./prompt";
import { claimTurnLease, getConversation, INTERRUPTED_TURN_REPLY, loadRecent, loadTurnMemory, releaseTurn, saveTurn, selectClarification } from "./store";
import { dispatchTool, type ToolContext } from "./tools/registry";
import type { AssistantScope, StoredTurn } from "./types";
import { finishUsage, reserveUsage, UsageAccumulator, type UsageOutcome, type UsageReservation } from "./usage";

export type AssistantMessageInput = {
  scope: AssistantScope; requestId: string;
  input: { kind: "text"; text: string }
    | { kind: "audio"; load: (signal: AbortSignal) => Promise<{ bytes: Uint8Array; mime: string }> };
  onProgress?: () => Promise<void> | void;
};
export class AssistantBusyError extends Error {
  readonly code = "ASSISTANT_BUSY";
  constructor() { super("Please wait for your current request to finish."); }
}
export const UNAVAILABLE_REPLY = "Sara's assistant is unavailable right now. Reply menu to continue.";
export const QUOTA_REPLY = "You've reached today's assistant limit. Reply menu to continue.";

async function message(input: AssistantMessageInput): Promise<AssistantReply> {
  if (!input.requestId || input.requestId.length > 200 || input.requestId.startsWith("approve:")) throw new Error("ASSISTANT_INVALID_REQUEST_ID");
  const claim = await claimTurnLease(input.scope, input.requestId);
  if (claim === "busy") throw new AssistantBusyError();
  if (!("status" in claim)) return claim;
  const started = Date.now();
  const controller = new AbortController();
  const usage = new UsageAccumulator();
  let reservation: UsageReservation | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let progress: ReturnType<typeof setTimeout> | undefined;
  let outcome: UsageOutcome = "error";
  let text = input.input.kind === "text" ? input.input.text.trim() : "";
  let transcript: string | null = null;
  let toolRecords: StoredTurn["toolRecords"] = [];
  let reply: AssistantReply = {
    conversationId: claim.conversationId, requestId: input.requestId,
    transcript: null, reply: ERROR_REPLY, draft: null, result: null,
  };
  const save = async (state: "RUNNING" | "DONE") => {
    await saveTurn(input.scope, input.requestId, {
      ...claim, userText: text, transcript, reply, toolRecords, state,
    });
  };
  try {
    const config = assistantConfig();
    if (!config.available || !config.enabled) {
      reply.reply = UNAVAILABLE_REPLY;
      outcome = "denied";
    } else {
      reservation = await reserveUsage(input.scope, input.requestId, input.input.kind === "audio" ? "VOICE" : "TEXT", new Date());
      if (!reservation) {
        reply.reply = QUOTA_REPLY;
        outcome = "denied";
      } else if (!reservation.fresh) {
        reply.reply = INTERRUPTED_TURN_REPLY;
      } else {
        deadline = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
        progress = setTimeout(() => {
          void Promise.resolve().then(() => input.onProgress?.()).catch(() => undefined);
        }, 4_000);
        if (input.input.kind === "audio") {
          const audio = await withinDeadline(transcribeAudio(input.input.load, controller.signal), controller.signal);
          usage.addAudioSeconds(audio.seconds);
          usage.addProviderRequestId(audio.providerRequestId);
          text = audio.text;
          transcript = audio.text;
          reply.transcript = transcript;
          // Save accepted transcript before interpreting it, including model failures.
          await save("RUNNING");
        }
        controller.signal.throwIfAborted();
        if (!text || text.length > 16_000) throw new Error("ASSISTANT_INVALID_TEXT");
        const [history, memory, business] = await withinDeadline(Promise.all([
          loadRecent(input.scope, new Date()), loadTurnMemory(input.scope, claim, new Date()),
          db.business.findFirst({ where: { id: input.scope.businessId }, select: { name: true, currency: true, sells: true } }),
        ]), controller.signal);
        controller.signal.throwIfAborted();
        if (!business) throw new Error("BUSINESS_NOT_FOUND");
        const selected = memory.clarification ? selectClarification(memory.clarification, text) : null;
        const originalEvidence = selected?.evidence ?? memory.editing?.evidence ?? memory.clarification?.evidence;
        const context: ToolContext = {
          ...claim, scope: input.scope, now: new Date(), signal: controller.signal,
          evidence: selected?.evidence ?? {
            text,
            recentOwnerTexts: [...(originalEvidence ? [originalEvidence.text, ...originalEvidence.recentOwnerTexts] : []), ...history.map((turn) => turn.userText)].slice(-24),
            selectedIds: originalEvidence?.selectedIds ?? [],
          },
        };
        if (memory.clarification && /^\d+$/.test(text) && !selected) {
          reply.reply = clarificationText({ kind: "clarification", ...memory.clarification });
        } else if (selected) {
          const resolved = await withinDeadline(dispatchTool(context, `draft_${selected.request.kind}`, JSON.stringify(selected.request)), controller.signal);
          controller.signal.throwIfAborted();
          if (resolved.kind === "draft") { reply.reply = resolved.draft.summary; reply.draft = resolved.draft; }
          else if (resolved.kind === "clarification") reply.reply = clarificationText(resolved);
          else reply.reply = resolved.kind === "error" ? resolved.message : resolved.text;
        } else {
          const result = await runModelTurn({ context, text, history, business, usage, editing: memory.editing });
          reply.reply = result.reply;
          reply.draft = result.draft;
          toolRecords = result.toolRecords;
        }
        controller.signal.throwIfAborted();
        outcome = reply.draft ? "draft" : "answered";
      }
    }
  } catch (error) {
    if (controller.signal.aborted) usage.markBillingUnknown();
    if (error instanceof AudioError) {
      if (error.audioSeconds !== undefined) usage.addAudioSeconds(error.audioSeconds);
      usage.addProviderRequestId(error.providerRequestId);
      if (error.billingUnknown) usage.markBillingUnknown();
      reply.reply = error.userMessage;
    } else reply.reply = ERROR_REPLY;
    reply.draft = null;
    outcome = "error";
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    if (progress !== undefined) clearTimeout(progress);
    if (transcript) reply.reply = transcriptPrefix(transcript) + reply.reply;
    // Attempt every cleanup independently; a ledger failure must not strand the lease.
    try {
      await save("DONE");
    } finally {
      try {
        if (reservation?.fresh) await finishUsage(reservation.id, usage.patch(outcome, Date.now() - started));
      } finally {
        await releaseTurn(input.scope, input.requestId, claim.leaseToken);
      }
    }
  }
  return reply;
}

export const assistantService = {
  message,
  available: () => assistantConfig().available,
  /** Scope-derived id for adapters that need conversation data before a request. */
  conversation: getConversation,
};
export { hasPendingClarification, hasEditingContext, loadTurnMemory } from "./store";

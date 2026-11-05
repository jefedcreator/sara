import { db } from "@/server/db";
import type { AssistantReply } from "types/assistant";
import { AudioError, transcribeAudio } from "./audio";
import { assistantConfig, TURN_TIMEOUT_MS } from "./config";
import { runModelTurn, clarificationText, readPageText, withinDeadline } from "./loop";
import { ERROR_REPLY } from "./prompt";
import { assertTurnCurrent, claimTurnLease, getConversation, INTERRUPTED_TURN_REPLY, loadRecent, loadTurnMemory, releaseTurn, saveClarification, saveReadPages, saveTurn, selectClarification } from "./store";
import { dispatchTool, type ToolContext } from "./tools/registry";
import type { OwnerEvidence } from "./actions/types";
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
export class AssistantTimeoutError extends Error {
  readonly code = "ASSISTANT_TIMEOUT";
  constructor() { super("That request took too long. Please try again."); }
}
export const UNAVAILABLE_REPLY = "Sara's assistant is unavailable right now. Reply menu to continue.";
export const QUOTA_REPLY = "You've reached today's assistant limit. Reply menu to continue.";

/** Reserve space for the original authorization before incidental bounded history. */
export function continuationEvidence(text: string, original: OwnerEvidence | undefined, history: StoredTurn[]): OwnerEvidence {
  const preserved = original ? [original.text, ...original.recentOwnerTexts] : [];
  return { text, recentOwnerTexts: [...new Set([...preserved, ...history.map((turn) => turn.userText)])].slice(0, 24),
    selectedIds: original?.selectedIds ?? [] };
}

async function message(input: AssistantMessageInput): Promise<AssistantReply> {
  if (!input.requestId || input.requestId.length > 200 || input.requestId.startsWith("approve:")) throw new Error("ASSISTANT_INVALID_REQUEST_ID");
  const started = Date.now();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
  // Claims may wait for a lock too. A timed-out acquisition rolls back in store.
  let claim: Awaited<ReturnType<typeof claimTurnLease>>;
  try { claim = await withinDeadline(claimTurnLease(input.scope, input.requestId, controller.signal), controller.signal); }
  catch (error) { clearTimeout(deadline); if (controller.signal.aborted) throw new AssistantTimeoutError(); throw error; }
  if (claim === "busy") { clearTimeout(deadline); throw new AssistantBusyError(); }
  if (!("status" in claim)) { clearTimeout(deadline); return claim; }
  const fence = claim;
  const usage = new UsageAccumulator();
  let reservation: UsageReservation | null = null;
  let progress: ReturnType<typeof setTimeout> | undefined;
  let progressWork: Promise<void> | undefined;
  let outcome: UsageOutcome = "error";
  let cleanupStarted = false;
  let text = input.input.kind === "text" ? input.input.text.trim() : "";
  let transcript: string | null = null;
  let toolRecords: StoredTurn["toolRecords"] = [];
  const reply: AssistantReply = { conversationId: fence.conversationId, requestId: input.requestId,
    transcript: null, reply: ERROR_REPLY, draft: null, result: null };
  const save = (state: "RUNNING" | "DONE", signal: AbortSignal) => saveTurn(input.scope, input.requestId, {
    ...fence, userText: text, transcript, reply: structuredClone(reply), toolRecords: structuredClone(toolRecords), state,
  }, signal);
  const current = async () => {
    controller.signal.throwIfAborted();
    if (!reservation?.fresh) throw new Error("ASSISTANT_RESERVATION_REQUIRED");
    await withinDeadline(assertTurnCurrent(input.scope, fence, { id: reservation.id, requestId: input.requestId }), controller.signal);
    controller.signal.throwIfAborted();
  };
  try {
    const config = assistantConfig();
    if (!config.available || !config.enabled) { reply.reply = UNAVAILABLE_REPLY; outcome = "denied"; }
    else {
      const memory = await withinDeadline(loadTurnMemory(input.scope, fence, new Date()), controller.signal);
      if (input.input.kind === "text" && /^next[.!]?$/i.test(text) && memory.readPages) {
        const { pages, next } = memory.readPages;
        reply.reply = next < pages.length ? readPageText(pages, next) : "That is the end of the report. What would you like to look up next?";
        await withinDeadline(saveReadPages(input.scope, fence, pages, Math.min(next + 1, pages.length), controller.signal), controller.signal);
        outcome = "answered";
      } else {
        const reserved = reserveUsage(input.scope, input.requestId, input.input.kind === "audio" ? "VOICE" : "TEXT", new Date()).then((value) => {
          reservation = value;
          // A quota write may ignore cancellation. It never authorizes late paid work.
          if (cleanupStarted && value?.fresh) void finishUsage(value.id, usage.patch("error", Date.now() - started)).catch(() => undefined);
          return value;
        });
        reservation = await withinDeadline(reserved, controller.signal);
        if (!reservation) { reply.reply = QUOTA_REPLY; outcome = "denied"; }
        else if (!reservation.fresh) reply.reply = INTERRUPTED_TURN_REPLY;
        else {
          progress = setTimeout(() => { progressWork = Promise.resolve().then(() => input.onProgress?.()).catch(() => undefined); }, Math.max(0, 4_000 - (Date.now() - started)));
          await current();
          if (input.input.kind === "audio") {
            const audio = await withinDeadline(transcribeAudio(input.input.load, controller.signal, current), controller.signal);
            usage.addAudioSeconds(audio.seconds); usage.addProviderRequestId(audio.providerRequestId);
            text = audio.text; transcript = audio.text; reply.transcript = transcript;
            await withinDeadline(save("RUNNING", controller.signal), controller.signal);
          }
          if (!text || text.length > 16_000) throw new Error("ASSISTANT_INVALID_TEXT");
          await current();
          const [history, business] = await withinDeadline(Promise.all([
            loadRecent(input.scope, new Date()),
            db.business.findFirst({ where: { id: input.scope.businessId }, select: { name: true, currency: true, sells: true } }),
          ]), controller.signal);
          if (!business) throw new Error("BUSINESS_NOT_FOUND");
          await current();
          const selected = memory.clarification ? selectClarification(memory.clarification, text) : null;
          const original = selected?.evidence ?? memory.editing?.evidence ?? memory.clarification?.evidence;
          const context: ToolContext = { ...fence, scope: input.scope, now: new Date(), signal: controller.signal,
            evidence: selected?.evidence ?? continuationEvidence(text, original, history), checkCurrent: current,
            pendingClarification: memory.clarification };
          if (memory.clarification && /^\d+$/.test(text) && !selected) {
            reply.reply = clarificationText({ kind: "clarification", ...memory.clarification });
          } else if (memory.clarification?.existingSelection && /^(?:yes|update(?:\s+it)?|use\s+(?:it|existing)|existing)[.!]?$/i.test(text)) {
            reply.reply = `What should I change on "${memory.clarification.existingSelection.label}"? Please give the new details, or a different name for a new record.`;
          } else if (selected && /^create_(customer|product|service)$/.test(selected.request.kind)) {
            const entity = selected.request.kind.slice(7);
            const question = `Use the existing ${entity} "${selected.selected.label}"? Tell me what to update, or give a different name for a new ${entity}.`;
            await withinDeadline(saveClarification(input.scope, fence, { question, choices: [], originalRequest: selected.request }, selected.evidence, controller.signal, selected.selected), controller.signal);
            reply.reply = question;
          } else if (selected) {
            const resolved = await withinDeadline(dispatchTool(context, `draft_${selected.request.kind}`, JSON.stringify(selected.request)), controller.signal);
            if (resolved.kind === "draft") { reply.reply = resolved.draft.summary; reply.draft = resolved.draft; }
            else if (resolved.kind === "clarification") reply.reply = clarificationText(resolved);
            else reply.reply = resolved.kind === "error" ? resolved.question ?? resolved.message : resolved.text;
          } else {
            const result = await withinDeadline(runModelTurn({ context, text, history, business, usage, editing: memory.editing, clarification: memory.clarification }), controller.signal);
            reply.reply = result.reply; reply.draft = result.draft; toolRecords = result.toolRecords;
            if (result.readPages) await withinDeadline(saveReadPages(input.scope, fence, result.readPages, 1, controller.signal), controller.signal);
          }
          await current();
          outcome = reply.draft ? "draft" : "answered";
        }
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
    reply.draft = null; outcome = "error";
  } finally {
    cleanupStarted = true;
    controller.abort(); // Fence outstanding transport/tool work before final persistence.
    if (progress !== undefined) clearTimeout(progress);
    // Independent cleanup attempts share one bounded 1s allowance (26s entry cap).
    const cleanup = new AbortController();
    let releasing: Promise<void> | undefined;
    const release = () => releasing ??= releaseTurn(input.scope, input.requestId, fence.leaseToken).catch(() => undefined);
    cleanup.signal.addEventListener("abort", () => { void release(); }, { once: true });
    const cleanupTimer = setTimeout(() => cleanup.abort(), Math.max(0, Math.min(1_000, started + TURN_TIMEOUT_MS + 1_000 - Date.now())));
    try {
      await withinDeadline(Promise.allSettled([
        save("DONE", cleanup.signal).finally(() => release()),
        reservation?.fresh ? finishUsage(reservation.id, usage.patch(outcome, Date.now() - started)) : Promise.resolve(),
        progressWork ?? Promise.resolve(),
        // Release follows save; the abort listener also attempts it if save hangs.
      ]), cleanup.signal).catch(() => undefined);
    } finally {
      // Exact token makes this safe even if save/usage ignored cancellation.
      await withinDeadline(release(), cleanup.signal).catch(() => undefined);
      clearTimeout(cleanupTimer); clearTimeout(deadline);
    }
  }
  return reply;
}

export const assistantService = { message, available: () => assistantConfig().available, conversation: getConversation };
export { hasPendingClarification, hasPendingReadPage, hasEditingContext, loadTurnMemory } from "./store";

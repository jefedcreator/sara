import type { ApprovalReply, AssistantChannel, AssistantReply, ActionResult } from "@/types/assistant";

import { assistantConfig } from "@/backend/services/assistant/config";
import { assistantService } from "@/backend/services/assistant";
import { approveAction } from "@/backend/services/assistant/actions/approve";
import { changeDraft, getPendingDraft } from "@/backend/services/assistant/actions/drafts";
import { hasEditingContext } from "@/backend/services/assistant/store";
import { transcriptPrefix } from "../assistant/audio";
import type { InboundMessage, OutboundMessage } from "./channels/types";
import type { HandleOptions } from "./engine";
import type { AssistantScope } from "@/backend/services/assistant/types";

const TYPED_APPROVAL = "Reply yes to send, or change something to edit.";
const UNAVAILABLE_REPLY = "I can't take voice notes right now — reply menu";

/** The id identifies an immutable action. Only a scoped database lookup authorizes it. */
export function parseAssistantButton(id: string): { action: "send" | "change"; actionId: string } | null {
  const match = /^assistant:(send|change):([A-Za-z0-9_-]{1,200})$/.exec(id);
  // `$` also matches before a final newline; require the whole input verbatim.
  if (match?.[0] !== id) return null;
  return { action: match[1] as "send" | "change", actionId: match[2]! };
}

function resultText(result: ActionResult): string {
  return result.link && !result.text.includes(result.link)
    ? `${result.text}\n${result.link}` : result.text;
}

/** Present canonical server text; never use model prose as evidence of execution. */
export function presentAssistantReply(
  channel: AssistantChannel,
  reply: AssistantReply | ApprovalReply,
): OutboundMessage {
  const prefix = channel !== "WEB" && "transcript" in reply && reply.transcript
    ? transcriptPrefix(reply.transcript) : "";
  let text: string;
  let buttons: OutboundMessage["buttons"];
  if (reply.result) {
    text = `${"status" in reply && reply.status === "already_done" ? "Already done.\n\n" : ""}${resultText(reply.result)}`;
  } else if (reply.draft?.status === "PENDING" && !("status" in reply)) {
    // The stored summary is also the approval's exact source of truth.
    text = reply.draft.summary;
    if (channel === "WHATSAPP") {
      if (!parseAssistantButton(`assistant:send:${reply.draft.id}`)) throw new Error("ASSISTANT_INVALID_ACTION_ID");
      buttons = [
        { id: `assistant:send:${reply.draft.id}`, title: "Send it" },
        { id: `assistant:change:${reply.draft.id}`, title: "Change something" },
      ];
    } else if (channel === "INSTAGRAM") {
      text += `\n\n${TYPED_APPROVAL}`;
    }
  } else {
    // Change/cancel/expiry replies must not resurrect a previous draft's buttons.
    text = reply.reply;
  }
  text = prefix + text;
  if (channel === "WHATSAPP" && text.length > 4_096) {
    // Reject rather than hide any financial or action detail behind truncation.
    throw new Error("ASSISTANT_REPLY_TOO_LONG");
  }
  return { text, ...(buttons ? { buttons } : {}) };
}

/** Called only after linking and the durable inbound-message claim. */
export async function routeAssistantMessage(
  scope: AssistantScope,
  message: InboundMessage,
  options?: HandleOptions,
): Promise<OutboundMessage> {
  const channel = message.channel as AssistantChannel;
  const config = assistantConfig();

  // Ignore unknown button ids even while the assistant is switched off.
  const button = message.kind === "button" ? parseAssistantButton(message.buttonId) : null;
  if (message.kind === "button" && !button) throw new Error("ASSISTANT_BUTTON_IGNORED");

  if (!config.enabled || !config.available) {
    return { text: message.kind === "voice" ? UNAVAILABLE_REPLY
      : "Sara's assistant is unavailable right now. Reply menu to continue." };
  }

  const now = new Date();

  // 1. Handle button presses
  if (message.kind === "button") {
    if (button) {
      if (button.action === "send") {
        const reply = await approveAction(scope, button.actionId, now);
        return presentAssistantReply(channel, reply);
      } else if (button.action === "change") {
        const draft = await changeDraft(scope, button.actionId);
        return presentAssistantReply(channel, { status: "changed", reply: "What should change?", draft, result: null });
      }
    }
    // Non-assistant button - throw to engine
    throw new Error("ASSISTANT_BUTTON_IGNORED");
  }

  // The service schedules this once after four seconds and isolates failures.
  const onProgress = async () => {
    try { await options?.onProgress?.({ text: "One moment…" }); } catch { /* Delivery cannot fail the turn. */ }
  };

  if (message.kind === "voice") {
    if (message.channel !== "WHATSAPP") throw new Error("ASSISTANT_UNSUPPORTED_INPUT");
    const reply = await assistantService.message({
      scope,
      requestId: message.messageId,
      input: { kind: "audio", load: async (signal) => {
        const { downloadWhatsAppAudio } = await import("./channels/whatsapp/media");
        return downloadWhatsAppAudio(message.mediaId, signal);
      } },
      onProgress,
    });
    return presentAssistantReply(channel, reply);
  }

  if (message.kind !== "text") {
    throw new Error("ASSISTANT_UNSUPPORTED_INPUT");
  }

  const lower = message.text.trim().toLowerCase();
  const editing = await hasEditingContext(scope, now);
  const correction = !["yes", "send it"].includes(lower) && /^(?:yes|send it)\b/.test(lower);
  const pendingDraft = !editing && (["yes", "send it", "change something"].includes(lower) || correction)
    ? await getPendingDraft(scope, now) : null;

  // Exact typed yes/send it with nonediting pending draft -> approve
  if (pendingDraft?.status === "PENDING" && (lower === "yes" || lower === "send it")) {
    const reply = await approveAction(scope, pendingDraft.id, now);
    return presentAssistantReply(channel, reply);
  }

  // Exact typed change something with nonediting pending draft -> edit
  if (pendingDraft?.status === "PENDING" && lower === "change something") {
    const draft = await changeDraft(scope, pendingDraft.id);
    return presentAssistantReply(channel, { status: "changed", reply: "What should change?", draft, result: null });
  }
  if (pendingDraft && correction) await changeDraft(scope, pendingDraft.id);
  // Clarification selections and read pagination are resolved under the service's
  // lease. The adapter never consumes or modifies that state itself.
  const reply = await assistantService.message({
    scope,
    requestId: message.messageId,
    input: { kind: "text", text: message.text },
    onProgress,
  });
  return presentAssistantReply(channel, reply);
}

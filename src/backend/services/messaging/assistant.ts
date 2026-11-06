import type { ApprovalReply, AssistantChannel, AssistantReply, ActionResult, DraftDto } from "types/assistant";

import { assistantConfig } from "@/backend/services/assistant/config";
import { assistantService } from "@/backend/services/assistant";
import { approveAction } from "@/backend/services/assistant/actions/approve";
import { changeDraft, cancelDraft, getPendingDraft } from "@/backend/services/assistant/actions/drafts";
import { selectClarification, hasPendingClarification, hasPendingReadPage } from "@/backend/services/assistant/store";
import { transcriptPrefix } from "../assistant/audio";
import type { OutboundMessage } from "./channels/types";
import type { InboundMessage, HandleOptions } from "./engine";
import type { AssistantScope } from "@/backend/services/assistant/types";

const TYPED_APPROVAL = "Reply yes to send, or change something to edit.";
const UNAVAILABLE_REPLY = "I can't take voice notes right now — reply menu";
const QUOTA_REPLY = "You've reached today's assistant limit. Reply menu to continue.";

/** The id identifies an immutable action. Only a scoped database lookup authorizes it. */
export function parseAssistantButton(id: string): { action: "send" | "change"; actionId: string } | null {
  const match = /^assistant:(send|change):([A-Za-z0-9_-]{1,200})$/.exec(id);
  // `$` also matches before a final newline; require the whole input verbatim.
  if (!match || match[0] !== id) return null;
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

/**
 * Route an inbound message to the assistant service or approval/change/cancel actions.
 * Called after identity lookup in the conversation engine.
 * Returns the outbound message or throws special error codes for engine handling.
 *
 * Throws:
 * - ASSISTANT_MENU_RESET: menu/0 was typed, engine should reset memory
 * - ASSISTANT_DRAFT_CANCELLED: cancel was typed, engine should reset memory
 * - ASSISTANT_BUTTON_IGNORED: non-assistant button, engine should ignore
 * - ASSISTANT_CLARIFICATION_SELECTED: digit matched clarification, engine should reload
 * - ASSISTANT_READ_PAGE_NEXT: next was typed with read pages, engine should serve page
 */
export async function routeAssistantMessage(
  scope: AssistantScope,
  message: InboundMessage,
  options?: HandleOptions,
): Promise<OutboundMessage> {
  const channel = message.channel as AssistantChannel;
  const config = assistantConfig();

  // Check availability first
  if (!config.enabled || !config.available) {
    if (message.kind === "voice") {
      return { text: UNAVAILABLE_REPLY };
    }
    // For text/buttons, throw to let engine handle or return unavailable
    throw new Error("ASSISTANT_UNAVAILABLE");
  }

  const now = new Date();

  // 1. Handle button presses
  if (message.kind === "button") {
    const button = parseAssistantButton(message.buttonId);
    if (button) {
      if (button.action === "send") {
        const reply = await approveAction(scope, button.actionId, now);
        return presentAssistantReply(channel, reply);
      } else if (button.action === "change") {
        const draft = await changeDraft(scope, button.actionId);
        return presentAssistantReply(channel, { reply: "What should change?", draft, result: null });
      }
    }
    // Non-assistant button - throw to engine
    throw new Error("ASSISTANT_BUTTON_IGNORED");
  }

  // 2. Handle voice messages
  if (message.kind === "voice") {
    const reply = await assistantService.message({
      scope,
      requestId: message.messageId,
      input: { kind: "audio", load: async (signal) => {
        const { loadVoiceMedia } = await import("./channels/whatsapp/media");
        return loadVoiceMedia(message.mediaId, signal);
      } },
      onProgress: options?.onProgress,
    });
    return presentAssistantReply(channel, reply);
  }

  // 3. Handle text messages
  if (message.kind !== "text") {
    throw new Error("ASSISTANT_UNSUPPORTED_INPUT");
  }

  const trimmed = message.text.trim();
  const lower = trimmed.toLowerCase();

  // Note: menu/0 and cancel are handled by the engine for backward compatibility
  // with the existing menu flow. They reset memory/state there.

  // 6. Check for pending draft and handle typed approvals/edits
  const pendingDraft = await getPendingDraft(scope, now);

  // Exact typed yes/send it with nonediting pending draft -> approve
  if (pendingDraft && pendingDraft.status === "PENDING" && (lower === "yes" || lower === "send it")) {
    const reply = await approveAction(scope, pendingDraft.id, now);
    return presentAssistantReply(channel, reply);
  }

  // Exact typed change something with nonediting pending draft -> edit
  if (pendingDraft && pendingDraft.status === "PENDING" && lower === "change something") {
    const draft = await changeDraft(scope, pendingDraft.id);
    return presentAssistantReply(channel, { reply: "What should change?", draft, result: null });
  }

  // 7. Check for pending clarification and handle digit selection
  if (/^\d+$/.test(trimmed)) {
    const clarification = await selectClarification(scope, parseInt(trimmed, 10));
    if (clarification) {
      throw new Error("ASSISTANT_CLARIFICATION_SELECTED");
    }
  }

  // 8. Check for pending read pages and handle next
  const hasReadPages = await hasPendingReadPage(scope, now);
  if (hasReadPages && (lower === "next" || lower === "next!" || lower === "next.")) {
    throw new Error("ASSISTANT_READ_PAGE_NEXT");
  }

  // 9. Check for active edit or other assistant contexts
  const hasClarification = await hasPendingClarification(scope, now);
  if (hasClarification) {
    const reply = await assistantService.message({
      scope,
      requestId: message.messageId,
      input: { kind: "text", text: message.text },
      onProgress: options?.onProgress,
    });
    return presentAssistantReply(channel, reply);
  }

  // 10. Route to assistant for all other text
  const reply = await assistantService.message({
    scope,
    requestId: message.messageId,
    input: { kind: "text", text: message.text },
    onProgress: options?.onProgress,
  });
  return presentAssistantReply(channel, reply);
}

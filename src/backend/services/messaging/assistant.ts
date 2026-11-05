import type { ApprovalReply, AssistantChannel, AssistantReply, ActionResult } from "types/assistant";

import { transcriptPrefix } from "../assistant/audio";
import type { OutboundMessage } from "./channels/types";

const TYPED_APPROVAL = "Reply yes to send, or change something to edit.";

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

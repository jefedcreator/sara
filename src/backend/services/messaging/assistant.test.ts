import { describe, expect, it, vi } from "vitest";
import type { ActionResult, ApprovalReply, AssistantReply } from "types/assistant";

// Keep these pure presentation tests independent of SDK/environment configuration.
vi.mock("../assistant/config", () => ({ assistantConfig: vi.fn() }));
vi.mock("../assistant/openai", () => ({ getOpenAI: vi.fn() }));

import { transcriptPrefix } from "../assistant/audio";
import { parseAssistantButton, presentAssistantReply } from "./assistant";

const summary = "Create an invoice for Ada?\n1 × Service · NGN 45,000 each · NGN 45,000\nTotal: NGN 45,000\nCreate an unpaid invoice. Stock is unchanged.";
function reply(overrides: Partial<AssistantReply> = {}): AssistantReply {
  return { conversationId: "c1", requestId: "m1", transcript: null, reply: summary,
    draft: { id: "action_1", summary, expiresAt: "2026-11-05T00:00:00.000Z", status: "PENDING" },
    result: null, ...overrides };
}

describe("parseAssistantButton", () => {
  it("accepts only the two exact action forms with bounded immutable IDs", () => {
    expect(parseAssistantButton("assistant:send:action_1")).toEqual({ action: "send", actionId: "action_1" });
    expect(parseAssistantButton("assistant:change:a-b_2")).toEqual({ action: "change", actionId: "a-b_2" });
    expect(parseAssistantButton(`assistant:send:${"a".repeat(200)}`)?.actionId).toHaveLength(200);
    for (const id of ["", "Send it", "assistant:send:", "assistant:approve:a", "assistant:send:a:b", "assistant:send:a\n", "assistant:change:a\r\n", "assistant:send:a\u2028", " assistant:send:a", "assistant:send:a ", "assistant:send:a.b", "assistant:SEND:a", `assistant:send:${"a".repeat(201)}`]) {
      expect(parseAssistantButton(id)).toBeNull();
    }
  });
});

describe("presentAssistantReply", () => {
  it("preserves the same canonical summary across channels and binds buttons to its action", () => {
    const source = reply({ reply: "Model claims an invoice was created" });
    expect(presentAssistantReply("WHATSAPP", source)).toEqual({ text: summary, buttons: [
      { id: "assistant:send:action_1", title: "Send it" },
      { id: "assistant:change:action_1", title: "Change something" },
    ] });
    expect(presentAssistantReply("INSTAGRAM", source)).toEqual({ text: `${summary}\n\nReply yes to send, or change something to edit.` });
    expect(presentAssistantReply("WEB", source)).toEqual({ text: summary });
  });

  it("adds the bounded transcript once for voice chat, keeping web and canonical summary separate", () => {
    const transcript = "Please create this invoice ".repeat(20);
    const source = reply({ transcript });
    const whatsapp = presentAssistantReply("WHATSAPP", source);
    expect(whatsapp.text).toBe(`${transcriptPrefix(transcript)}${summary}`);
    expect(whatsapp.text.match(/🎙️/g)).toHaveLength(1);
    expect(source.reply).toBe(summary);
    expect(source.draft!.summary).toBe(summary);
    expect(presentAssistantReply("WEB", source).text).toBe(summary);
    expect(presentAssistantReply("INSTAGRAM", source).text).toBe(`${transcriptPrefix(transcript)}${summary}\n\nReply yes to send, or change something to edit.`);
  });

  it("presents direct read replies without approval controls", () => {
    expect(presentAssistantReply("WHATSAPP", reply({ draft: null, reply: "You have 2 unpaid invoices." }))).toEqual({ text: "You have 2 unpaid invoices." });
  });

  it("presents stored execution results and links, ignoring unsupported model success prose", () => {
    const result: ActionResult = { text: "Invoice INV-1 created.", resourceId: "inv_1", link: "https://sara.ng/invoices/inv_1", affected: ["invoices"] };
    expect(presentAssistantReply("WHATSAPP", reply({ result, reply: "A different invoice was created." }))).toEqual({ text: `${result.text}\n${result.link}` });
    const approved: ApprovalReply = { status: "already_done", reply: "Ignored prose", result, draft: null };
    expect(presentAssistantReply("INSTAGRAM", approved)).toEqual({ text: `Already done.\n\n${result.text}\n${result.link}` });
    expect(presentAssistantReply("WHATSAPP", { ...approved, status: "approved", result: { ...result, text: `${result.text}\n${result.link}` } }).text).toBe(`${result.text}\n${result.link}`);
  });

  it("does not resurrect approval buttons after change, cancellation or expiry", () => {
    for (const status of ["changed", "cancelled", "expired"] as const) {
      const source: ApprovalReply = { status, reply: "What would you like to change?", result: null, draft: reply().draft };
      expect(presentAssistantReply("WHATSAPP", source)).toEqual({ text: source.reply });
    }
    expect(presentAssistantReply("WHATSAPP", reply({ draft: { ...reply().draft!, status: "REPLACED" }, reply: "That preview was replaced." }))).toEqual({ text: "That preview was replaced." });
  });

  it("refuses oversized WhatsApp presentation without truncating action details", () => {
    const source = reply({ draft: { ...reply().draft!, summary: "x".repeat(4097) } });
    expect(() => presentAssistantReply("WHATSAPP", source)).toThrow("ASSISTANT_REPLY_TOO_LONG");
    expect(source.draft!.summary).toHaveLength(4097);
    expect(presentAssistantReply("WHATSAPP", reply({ transcript: "🎙".repeat(250), draft: { ...reply().draft!, summary: "x".repeat(3500) } })).text.length).toBeLessThanOrEqual(4096);
    const prefix = transcriptPrefix("Create this invoice");
    const atLimit = reply({ transcript: "Create this invoice", draft: { ...reply().draft!, summary: "x".repeat(4096 - prefix.length) } });
    expect(presentAssistantReply("WHATSAPP", atLimit).text).toHaveLength(4096);
    expect(() => presentAssistantReply("WHATSAPP", { ...atLimit, draft: { ...atLimit.draft!, summary: `${atLimit.draft!.summary}x` } })).toThrow("ASSISTANT_REPLY_TOO_LONG");
  });

  it("rejects malformed draft IDs before constructing approval controls", () => {
    for (const id of ["", "a\n", "a:b", "a".repeat(201)]) {
      expect(() => presentAssistantReply("WHATSAPP", reply({ draft: { ...reply().draft!, id } }))).toThrow("ASSISTANT_INVALID_ACTION_ID");
    }
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult, ApprovalReply, AssistantReply } from "types/assistant";

// Keep these pure presentation tests independent of SDK/environment configuration.
vi.mock("../assistant/config", () => ({ assistantConfig: vi.fn() }));
vi.mock("../assistant/openai", () => ({ getOpenAI: vi.fn() }));
vi.mock("../assistant", () => ({ assistantService: { message: vi.fn() } }));
vi.mock("../assistant/actions/approve", () => ({ approveAction: vi.fn() }));
vi.mock("../assistant/actions/drafts", () => ({ changeDraft: vi.fn(), getPendingDraft: vi.fn() }));
vi.mock("../assistant/store", () => ({ hasEditingContext: vi.fn() }));
vi.mock("./channels/whatsapp/media", () => ({ downloadWhatsAppAudio: vi.fn() }));

import { transcriptPrefix } from "../assistant/audio";
import { parseAssistantButton, presentAssistantReply, routeAssistantMessage } from "./assistant";
import { assistantConfig } from "../assistant/config";
import { assistantService } from "../assistant";
import { approveAction } from "../assistant/actions/approve";
import { changeDraft, getPendingDraft } from "../assistant/actions/drafts";
import { hasEditingContext } from "../assistant/store";
import { downloadWhatsAppAudio } from "./channels/whatsapp/media";
import type { AssistantScope } from "../assistant/types";
import type { InboundMessage } from "./channels/types";

const summary = "Create an invoice for Ada?\n1 × Service · NGN 45,000 each · NGN 45,000\nTotal: NGN 45,000\nCreate an unpaid invoice. Stock is unchanged.";
function reply(overrides: Partial<AssistantReply> = {}): AssistantReply {
  return { conversationId: "c1", requestId: "m1", transcript: null, reply: summary,
    draft: { id: "action_1", summary, expiresAt: "2026-11-05T00:00:00.000Z", status: "PENDING" },
    result: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assistantConfig).mockReturnValue({ enabled: true, available: true, dailyLimit: 100, model: "gpt-5.4-mini", transcribeModel: "whisper-1" });
  vi.mocked(hasEditingContext).mockResolvedValue(false);
  vi.mocked(getPendingDraft).mockResolvedValue(null);
  vi.mocked(changeDraft).mockResolvedValue(reply().draft!);
  vi.mocked(assistantService.message).mockResolvedValue(reply({ draft: null, reply: "Your report" }));
  vi.mocked(approveAction).mockResolvedValue({ status: "approved", reply: "Done", draft: null, result: { text: "Invoice INV-1 created.", link: null, resourceId: "inv1", affected: ["invoices"] } });
});

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

describe("routeAssistantMessage", () => {
  const scope: AssistantScope = { businessId: "biz_1", channel: "WHATSAPP", principalId: "identity_1" };
  const inbound = (text: string): InboundMessage => ({ channel: "WHATSAPP", externalId: "234800", messageId: "m1", kind: "text", text });
  const button = (buttonId: string): InboundMessage => ({ channel: "WHATSAPP", externalId: "234800", messageId: "button1", kind: "button", buttonId });
  const voice: InboundMessage = { channel: "WHATSAPP", externalId: "234800", messageId: "voice1", kind: "voice", mediaId: "123", mime: "audio/ogg" };

  it.each(["yes", " YES ", "send it"])("approves only an exact typed %s with a scoped pending preview and no model call", async (text) => {
    vi.mocked(getPendingDraft).mockResolvedValue(reply().draft);
    expect((await routeAssistantMessage(scope, inbound(text))).text).toBe("Invoice INV-1 created.");
    expect(approveAction).toHaveBeenCalledWith(scope, "action_1", expect.any(Date));
    expect(assistantService.message).not.toHaveBeenCalled();
  });

  it("routes typed yes without a pending preview as an ordinary assistant turn", async () => {
    await routeAssistantMessage(scope, inbound("yes"));
    expect(approveAction).not.toHaveBeenCalled();
    expect(assistantService.message).toHaveBeenCalledWith(expect.objectContaining({ scope, requestId: "m1", input: { kind: "text", text: "yes" } }));
  });

  it("keeps editing yes as a correction and never approves the old preview", async () => {
    vi.mocked(hasEditingContext).mockResolvedValue(true);
    vi.mocked(getPendingDraft).mockResolvedValue(reply().draft);
    await routeAssistantMessage(scope, inbound("yes"));
    expect(approveAction).not.toHaveBeenCalled();
    expect(assistantService.message).toHaveBeenCalled();
  });

  it("starts editing on a nonexact confirmation and sends the whole correction to the service", async () => {
    vi.mocked(getPendingDraft).mockResolvedValue(reply().draft);
    await routeAssistantMessage(scope, inbound("yes but make it three"));
    expect(changeDraft).toHaveBeenCalledWith(scope, "action_1");
    expect(approveAction).not.toHaveBeenCalled();
    expect(assistantService.message).toHaveBeenCalledWith(expect.objectContaining({ input: { kind: "text", text: "yes but make it three" } }));
  });

  it.each(["typed", "button"])("%s change asks for a correction without resurfacing approval buttons", async (kind) => {
    vi.mocked(getPendingDraft).mockResolvedValue(reply().draft);
    const source = kind === "typed" ? inbound("change something") : button("assistant:change:action_1");
    expect(await routeAssistantMessage(scope, source)).toEqual({ text: "What should change?" });
    expect(changeDraft).toHaveBeenCalledWith(scope, "action_1");
    expect(assistantService.message).not.toHaveBeenCalled();
  });

  it("uses only the scoped immutable id from a send button", async () => {
    await routeAssistantMessage(scope, button("assistant:send:old_action"));
    expect(approveAction).toHaveBeenCalledWith(scope, "old_action", expect.any(Date));
    expect(assistantService.message).not.toHaveBeenCalled();
  });

  it("ignores unknown buttons with no model or action calls", async () => {
    await expect(routeAssistantMessage(scope, button("Send it"))).rejects.toThrow("ASSISTANT_BUTTON_IGNORED");
    expect(approveAction).not.toHaveBeenCalled();
    expect(assistantService.message).not.toHaveBeenCalled();
  });

  it("passes audio lazily with its request id; a transcript saying yes cannot approve", async () => {
    vi.mocked(assistantService.message).mockResolvedValue(reply({ draft: null, transcript: "yes", reply: "What should I help with?" }));
    expect((await routeAssistantMessage(scope, voice)).text).toBe('🎙️ "yes"\n\nWhat should I help with?');
    expect(approveAction).not.toHaveBeenCalled();
    expect(downloadWhatsAppAudio).not.toHaveBeenCalled();
    const input = vi.mocked(assistantService.message).mock.calls[0]![0];
    expect(input.scope).toEqual(scope);
    expect(input.requestId).toBe("voice1");
    if (input.input.kind !== "audio") throw new Error("Expected lazy audio");
    const signal = new AbortController().signal;
    await input.input.load(signal);
    expect(downloadWhatsAppAudio).toHaveBeenCalledWith("123", signal);
  });

  it("sends the service's slow-progress event as text and isolates delivery rejection", async () => {
    const onProgress = vi.fn().mockRejectedValue(new Error("send failed"));
    await routeAssistantMessage(scope, inbound("Read report"), { onProgress });
    await expect(Promise.resolve(vi.mocked(assistantService.message).mock.calls[0]![0].onProgress?.())).resolves.toBeUndefined();
    expect(onProgress).toHaveBeenCalledWith({ text: "One moment…" });
  });

  it("disables voice and approvals without downloading, model calls or mutations", async () => {
    vi.mocked(assistantConfig).mockReturnValue({ enabled: false, available: false, dailyLimit: 100, model: "gpt-5.4-mini", transcribeModel: "whisper-1" });
    expect((await routeAssistantMessage(scope, voice)).text).toBe("I can't take voice notes right now — reply menu");
    expect((await routeAssistantMessage(scope, button("assistant:send:a"))).text).toContain("unavailable");
    expect(assistantService.message).not.toHaveBeenCalled();
    expect(approveAction).not.toHaveBeenCalled();
    expect(downloadWhatsAppAudio).not.toHaveBeenCalled();
  });
});

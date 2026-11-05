import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    WHATSAPP_VERIFY_TOKEN: "verify_me",
    WHATSAPP_PHONE_NUMBER_ID: "PNID",
    WHATSAPP_TOKEN: "wa_token",
    META_APP_SECRET: "app_secret",
  },
}));

vi.mock("@/server/link-cards", () => ({
  primeLinkCard: vi.fn().mockResolvedValue(undefined),
}));

import { primeLinkCard } from "@/server/link-cards";

import { extractFirstUrl, whatsAppAdapter } from "./index";

beforeEach(() => vi.clearAllMocks());

describe("extractFirstUrl", () => {
  it("extracts clean HTTP and HTTPS urls", () => {
    expect(
      extractFirstUrl("Welcome! Connect: https://sara.ng/link?t=abc."),
    ).toBe("https://sara.ng/link?t=abc");
    expect(
      extractFirstUrl("Visit (https://sara.ng/invoices/123) to view"),
    ).toBe("https://sara.ng/invoices/123");
    expect(extractFirstUrl("No link here")).toBeNull();
  });
});

describe("verify", () => {
  it("echoes the challenge on a matching token", () => {
    const req = new Request("https://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify_me&hub.challenge=C123");
    expect(whatsAppAdapter.verify(req).status).toBe(200);
  });
  it("rejects a wrong token", () => {
    const req = new Request("https://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=C");
    expect(whatsAppAdapter.verify(req).status).toBe(403);
  });
});

describe("normalizeInbound", () => {
  it("extracts text messages and the sender", () => {
    const payload = {
      entry: [{ changes: [{ value: {
        contacts: [{ profile: { name: "Ada" }, wa_id: "234800" }],
        messages: [{ from: "234800", id: "wamid.1", type: "text", text: { body: "hi" } }],
      } }] }],
    };
    expect(whatsAppAdapter.normalizeInbound(payload)).toEqual([
      { channel: "WHATSAPP", externalId: "234800", kind: "text", text: "hi", messageId: "wamid.1", displayName: "Ada" },
    ]);
  });
  it("ignores non-text messages", () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ from: "x", id: "1", type: "image" }] } }] }] };
    expect(whatsAppAdapter.normalizeInbound(payload)).toEqual([]);
  });

  it("carries audio media metadata without downloading audio", () => {
    const fetchMock = vi.spyOn(global, "fetch");
    const payload = { entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: "Ada" }, wa_id: "234800" }],
      messages: [{ from: "234800", id: "m1", type: "audio", audio: { id: "media1", mime_type: "audio/ogg; codecs=opus" } },
        { from: "234800", id: "m2", type: "audio", audio: { id: "media2" } }],
    } }] }] };
    expect(whatsAppAdapter.normalizeInbound(payload)).toEqual([
      { channel: "WHATSAPP", externalId: "234800", messageId: "m1", displayName: "Ada", kind: "voice", mediaId: "media1", mime: "audio/ogg; codecs=opus" },
      { channel: "WHATSAPP", externalId: "234800", messageId: "m2", displayName: "Ada", kind: "voice", mediaId: "media2", mime: null },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries the immutable button ID and never its owner-like display title", () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{
      from: "234800", id: "m1", type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "assistant:send:action_1", title: "Create a different invoice" } },
    }] } }] }] };
    expect(whatsAppAdapter.normalizeInbound(payload)).toEqual([
      { channel: "WHATSAPP", externalId: "234800", messageId: "m1", kind: "button", buttonId: "assistant:send:action_1" },
    ]);
  });

  it("keeps unsupported but well-formed button IDs as controls for scoped routing", () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{
      from: "234800", id: "m1", type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "unsupported", title: "yes" } },
    }] } }] }] };
    expect(whatsAppAdapter.normalizeInbound(payload)).toEqual([
      { channel: "WHATSAPP", externalId: "234800", messageId: "m1", kind: "button", buttonId: "unsupported" },
    ]);
  });

  it("ignores malformed media/buttons, stickers and delivery statuses", () => {
    const messages = [
      { from: "234800", id: "a", type: "audio", audio: {} },
      { from: "234800", id: "s", type: "sticker", sticker: { id: "s1" } },
      ...[undefined, 123, "", " x", "x\n", "x".repeat(257)].map((id) => ({
        from: "234800", id: "b", type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "Send it" } },
      })),
      { id: "missing-sender", type: "text", text: { body: "hello" } },
    ];
    expect(whatsAppAdapter.normalizeInbound({ entry: [{ changes: [{ value: { messages, statuses: [{ id: "status" }] } }] }] })).toEqual([]);
  });
});

describe("send", () => {
  const buttons = [
    { id: "assistant:send:action_1", title: "Send it" },
    { id: "assistant:change:action_1", title: "Change something" },
  ];

  it("sends reply buttons with immutable action IDs", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}"));
    await whatsAppAdapter.send("234800", { text: "Create invoice?", buttons });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({
      messaging_product: "whatsapp", to: "234800", type: "interactive",
      interactive: { type: "button", body: { text: "Create invoice?" }, action: {
        buttons: buttons.map((reply) => ({ type: "reply", reply })),
      } },
    });
  });

  it("sends an over-1024 summary exactly before its buttons, preserving link previews", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async () => new Response("{}"));
    const summary = `${"Amount: NGN 45,000\n".repeat(80)}https://sara.ng/invoices/inv_1`;
    await whatsAppAdapter.send("234800", { text: summary, buttons });
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1]!.body as string));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ type: "text", text: { body: summary, preview_url: true } });
    expect(bodies[1]).toMatchObject({ type: "interactive", interactive: { body: { text: "Use the summary above." }, action: { buttons: buttons.map((reply) => ({ type: "reply", reply })) } } });
    expect(primeLinkCard).toHaveBeenCalledWith("https://sara.ng/invoices/inv_1");
  });

  it("does not send buttons when summary delivery fails", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response('{"error":{"code":131047}}', { status: 400 }));
    await expect(whatsAppAdapter.send("234800", { text: "x".repeat(1025), buttons })).resolves.toEqual({ ok: false, code: 131047 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not send buttons when the summary request throws", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockRejectedValue(new Error("network unavailable"));
    await expect(whatsAppAdapter.send("234800", { text: "x".repeat(1025), buttons })).rejects.toThrow("network unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps 1024 characters interactive and permits an exact 4096 summary", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async () => new Response("{}"));
    await whatsAppAdapter.send("234800", { text: "x".repeat(1024), buttons });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).type).toBe("interactive");
    fetchMock.mockClear();
    await whatsAppAdapter.send("234800", { text: "x".repeat(4096), buttons });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).text.body).toHaveLength(4096);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid buttons and oversized summaries before any request", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    for (const invalid of [
      [...buttons, { id: "third", title: "Third" }, { id: "fourth", title: "Fourth" }],
      [{ id: "a", title: "x".repeat(21) }], [{ id: "", title: "Send it" }],
      [{ id: "a", title: "   " }], [{ id: "a\n", title: "Send it" }],
      [{ id: "a".repeat(257), title: "Send it" }], [buttons[0]!, buttons[0]!],
    ]) await expect(whatsAppAdapter.send("234800", { text: "Summary", buttons: invalid })).rejects.toThrow("WHATSAPP_INVALID_BUTTONS");
    await expect(whatsAppAdapter.send("234800", { text: "x".repeat(4097), buttons })).rejects.toThrow("WHATSAPP_MESSAGE_TOO_LONG");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts exactly three buttons with a 20-character title and 256-character ID", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}"));
    const bounded = [...buttons, { id: "a".repeat(256), title: "x".repeat(20) }];
    await expect(whatsAppAdapter.send("234800", { text: "Summary", buttons: bounded })).resolves.toEqual({ ok: true });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).interactive.action.buttons).toEqual(bounded.map((reply) => ({ type: "reply", reply })));
  });

  it("posts a text message to the Graph API", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await whatsAppAdapter.send("234800", { text: "hello" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/PNID/messages",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as any).body);
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      to: "234800",
      type: "text",
      text: { body: "hello", preview_url: true },
    });
    expect(primeLinkCard).not.toHaveBeenCalled();
  });

  it("renders the link's card before sending, so Meta finds it ready", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await whatsAppAdapter.send("234800", {
      text: "Invoice INV-1 is ready: https://sara.ng/invoices/inv_1.",
    });

    expect(primeLinkCard).toHaveBeenCalledWith("https://sara.ng/invoices/inv_1");
    // The message only: no scrape request to Graph first.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://graph.facebook.com/v21.0/PNID/messages");
    expect(vi.mocked(primeLinkCard).mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0]!,
    );
  });

  it("returns Meta's error code when a send fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 131047 } }), { status: 400 }),
    );
    await expect(
      whatsAppAdapter.send("234800", { text: "hello" }),
    ).resolves.toEqual({ ok: false, code: 131047 });
  });

  it("resolves ok when Meta accepts the message", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(
      whatsAppAdapter.send("234800", { text: "hello" }),
    ).resolves.toEqual({ ok: true });
  });
});

describe("sendTemplate", () => {
  it("posts a template with the body parameters", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await whatsAppAdapter.sendTemplate("234800", {
      name: "sara_alert",
      language: "en",
      bodyParams: ["a\nb"],
    });
    expect(result).toEqual({ ok: true });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as any).body);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "234800",
      type: "template",
      template: {
        name: "sara_alert",
        language: { code: "en" },
        components: [{ type: "body", parameters: [{ type: "text", text: "a · b" }] }],
      },
    });
  });
});

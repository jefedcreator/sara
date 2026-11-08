import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboundMessage } from "@/backend/services/messaging/channels/types";

const callbacks = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", async (original) => ({
  ...await original<typeof import("next/server")>(),
  after: vi.fn((callback: () => Promise<void>) => callbacks.push(callback)),
}));
const env = vi.hoisted(() => ({
  WHATSAPP_VERIFY_TOKEN: "verify_me" as string | undefined,
  WHATSAPP_PHONE_NUMBER_ID: "PNID",
  WHATSAPP_TOKEN: "wa_token",
  META_APP_SECRET: "app_secret",
}));
vi.mock("@/env", () => ({ env }));
vi.mock("@/server/link-cards", () => ({ primeLinkCard: vi.fn() }));
vi.mock("@/backend/services/messaging/engine", () => ({ conversationEngine: { handle: vi.fn() } }));

import { whatsAppAdapter } from "@/backend/services/messaging/channels/whatsapp";
import { conversationEngine } from "@/backend/services/messaging/engine";
import { GET, POST, maxDuration, runtime } from "./route";

const CONTEXT = { params: Promise.resolve({}) };

const handle = vi.mocked(conversationEngine.handle);
function postReq(rawBody: string, validSignature = true) {
  const signature = crypto.createHmac("sha256", "app_secret").update(rawBody).digest("hex");
  return new Request("https://x/api/webhooks/whatsapp", {
    method: "POST", body: rawBody,
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${validSignature ? signature : "invalid"}` },
  });
}
function payload(messages = [{ from: "234800", id: "wamid.1", type: "text", text: { body: "yes" } }]) {
  return JSON.stringify({ entry: [{ changes: [{ value: { messages } }] }] });
}

beforeEach(() => {
  vi.restoreAllMocks();
  callbacks.length = 0;
  handle.mockReset().mockResolvedValue({ text: "Finished" });
  vi.spyOn(whatsAppAdapter, "send").mockResolvedValue({ ok: true });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("WhatsApp webhook", () => {
  it("preserves GET verification and deployment settings", async () => {
    const response = await GET(new Request("https://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify_me&hub.challenge=C123"), CONTEXT);
    expect(await response.text()).toBe("C123");
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });

  it("acknowledges without waiting for engine work and awaits the entire callback", async () => {
    let finish!: (reply: OutboundMessage) => void;
    handle.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const signedRequest = postReq(payload());
    const response = await POST(signedRequest, CONTEXT);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(handle).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);
    let completed = false;
    const processing = callbacks.shift()!().then(() => { completed = true; });
    expect(handle).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    finish({ text: "Finished" });
    await processing;
    expect(whatsAppAdapter.send).toHaveBeenCalledWith("234800", { text: "Finished" });
  });

  it("verifies the exact raw body and schedules nothing for invalid or changed signatures", async () => {
    expect((await POST(postReq(payload(), false), CONTEXT)).status).toBe(403);
    const signed = postReq(payload());
    const changedBody = new Request(signed.url, { method: "POST", body: `${payload()} `, headers: signed.headers });
    expect((await POST(changedBody, CONTEXT)).status).toBe(403);
    expect(callbacks).toHaveLength(0);
    expect(handle).not.toHaveBeenCalled();
  });

  it.each(["{private malformed", '{"entry":{}}'])("handles malformed verified payloads before scheduling: %s", async (rawBody) => {
    expect((await POST(postReq(rawBody), CONTEXT)).status).toBe(200);
    expect(callbacks).toHaveLength(0);
    expect(handle).not.toHaveBeenCalled();
  });

  it("does not schedule delivery-only events", async () => {
    const rawBody = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "status1" }] } }] }] });
    expect((await POST(postReq(rawBody), CONTEXT)).status).toBe(200);
    expect(callbacks).toHaveLength(0);
  });

  it("normalizes before scheduling and preserves the order of same-sender messages", async () => {
    const normalize = vi.spyOn(whatsAppAdapter, "normalizeInbound");
    const response = await POST(postReq(payload([
      { from: "234800", id: "m1", type: "text", text: { body: "Create invoice" } },
      { from: "234800", id: "m2", type: "text", text: { body: "yes" } },
    ])), CONTEXT);
    expect(response.status).toBe(200);
    expect(normalize).toHaveBeenCalledTimes(1);
    expect(handle).not.toHaveBeenCalled();
    await callbacks.shift()!();
    expect(handle.mock.calls.map(([message]) => message.messageId)).toEqual(["m1", "m2"]);
    expect(vi.mocked(whatsAppAdapter.send).mock.invocationCallOrder[0]).toBeLessThan(handle.mock.invocationCallOrder[1]!);
  });

  it("passes audio metadata and immutable buttons through the deferred engine and preserves replies", async () => {
    const rawBody = JSON.stringify({ entry: [{ changes: [{ value: { messages: [
      { from: "234800", id: "m-audio", type: "audio", audio: { id: "private-media", mime_type: "audio/ogg; codecs=opus" } },
      { from: "234800", id: "m-button", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "assistant:send:a", title: "Send it" } } },
    ] } }] }] });
    const reply = { text: "Exact invoice summary", buttons: [{ id: "assistant:send:a", title: "Send it" }] };
    handle.mockResolvedValue(reply);
    await POST(postReq(rawBody), CONTEXT);
    expect(handle).not.toHaveBeenCalled();
    await callbacks.shift()!();
    expect(handle).toHaveBeenNthCalledWith(1, expect.objectContaining({ kind: "voice", mediaId: "private-media", mime: "audio/ogg; codecs=opus" }), expect.objectContaining({ onProgress: expect.any(Function) }));
    expect(handle).toHaveBeenNthCalledWith(2, expect.objectContaining({ kind: "button", buttonId: "assistant:send:a" }), expect.any(Object));
    expect(whatsAppAdapter.send).toHaveBeenCalledTimes(2);
    expect(whatsAppAdapter.send).toHaveBeenCalledWith("234800", reply);
  });

  it("delivers progress followed by the final text reply", async () => {
    handle.mockImplementationOnce(async (_message, options) => {
      await options?.onProgress?.({ text: "One moment…" });
      return { text: "Invoice created" };
    });
    await POST(postReq(payload()), CONTEXT);
    await callbacks.shift()!();
    expect(whatsAppAdapter.send).toHaveBeenNthCalledWith(1, "234800", { text: "One moment…" });
    expect(whatsAppAdapter.send).toHaveBeenNthCalledWith(2, "234800", { text: "Invoice created" });
  });

  it("keeps debug logs authenticated and free of raw bodies, replies, media and sender identifiers", async () => {
    env.WHATSAPP_VERIFY_TOKEN = "debug-token";
    try {
      const rawBody = payload([{ from: "private-owner", id: "safe-message-id", type: "text", text: { body: "private-transcript https://media.test/token" } }]);
      handle.mockResolvedValueOnce({ text: "private-reply" })
        .mockRejectedValueOnce(new Error("private-error"));
      await POST(postReq(rawBody), CONTEXT);
      await callbacks.shift()!();
      await POST(postReq(rawBody), CONTEXT);
      await callbacks.shift()!();
      await POST(postReq(rawBody, false), CONTEXT);
      expect((await GET(new Request("https://x/api/webhooks/whatsapp?debug=1"), CONTEXT)).status).toBe(401);
      const response = await GET(new Request("https://x/api/webhooks/whatsapp?debug=1&token=debug-token"), CONTEXT);
      const logs = await response.text();
      expect(logs).toContain("safe-message-id");
      for (const secret of ["private-owner", "private-transcript", "private-reply", "media.test", "private-error", "signaturePrefix", "rawPreview"]) expect(logs).not.toContain(secret);
    } finally {
      env.WHATSAPP_VERIFY_TOKEN = "verify_me";
    }
  });

  it("logs safe Graph failure codes and success status without phone numbers or response bodies", async () => {
    vi.mocked(whatsAppAdapter.send).mockRestore();
    const fetchMock = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 131047, message: "private response wa_token https://media.test/private" } }), { status: 400 }))
      .mockResolvedValueOnce(new Response("{}"));
    await POST(postReq(payload([
      { from: "private-owner", id: "m1", type: "text", text: { body: "private transcript" } },
      { from: "other-owner", id: "m2", type: "text", text: { body: "hello" } },
    ])), CONTEXT);
    await callbacks.shift()!();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith("[WhatsApp] send_failed", { status: 400, code: 131047 });
    expect(console.warn).toHaveBeenCalledWith("[Messaging] delivery_failed", expect.objectContaining({ code: 131047 }));
    expect(console.info).toHaveBeenCalledWith("[WhatsApp] message_sent", { status: 200 });
    const logs = JSON.stringify([
      ...vi.mocked(console.error).mock.calls, ...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.info).mock.calls,
    ]);
    for (const secret of ["private response", "wa_token", "media.test", "private-owner", "other-owner", "private transcript"]) expect(logs).not.toContain(secret);
  });
});

import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboundMessage } from "@/backend/services/messaging/channels/types";

const callbacks = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", async (original) => ({
  ...await original<typeof import("next/server")>(),
  after: vi.fn((callback: () => Promise<void>) => callbacks.push(callback)),
}));
vi.mock("@/env", () => ({ env: {
  INSTAGRAM_VERIFY_TOKEN: "ig_verify", INSTAGRAM_IG_ID: "IGID",
  INSTAGRAM_PAGE_TOKEN: "ig_token", META_APP_SECRET: "app_secret",
} }));
vi.mock("@/backend/services/messaging/engine", () => ({ conversationEngine: { handle: vi.fn() } }));

import { instagramAdapter } from "@/backend/services/messaging/channels/instagram";
import { conversationEngine } from "@/backend/services/messaging/engine";
import { GET, POST, maxDuration, runtime } from "./route";

const CONTEXT = { params: Promise.resolve({}) };

const handle = vi.mocked(conversationEngine.handle);
function postReq(rawBody: string, validSignature = true) {
  const signature = crypto.createHmac("sha256", "app_secret").update(rawBody).digest("hex");
  return new Request("https://x/api/webhooks/instagram", {
    method: "POST", body: rawBody,
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${validSignature ? signature : "invalid"}` },
  });
}
function payload(messages = [{ sender: { id: "igsid_1" }, message: { mid: "mid_1", text: "yes" } }]) {
  return JSON.stringify({ entry: [{ messaging: messages }] });
}

beforeEach(() => {
  vi.restoreAllMocks();
  callbacks.length = 0;
  handle.mockReset().mockResolvedValue({ text: "Finished" });
  vi.spyOn(instagramAdapter, "send").mockResolvedValue({ ok: true });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("Instagram webhook", () => {
  it("preserves GET verification and deployment settings", async () => {
    const response = await GET(new Request("https://x/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=ig_verify&hub.challenge=C9"), CONTEXT);
    expect(await response.text()).toBe("C9");
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
    expect(instagramAdapter.send).toHaveBeenCalledWith("igsid_1", { text: "Finished" });
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
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private malformed");
  });

  it("normalizes before scheduling and retains the input order of typed confirmations", async () => {
    const normalize = vi.spyOn(instagramAdapter, "normalizeInbound");
    const response = await POST(postReq(payload([
      { sender: { id: "igsid_1" }, message: { mid: "mid_1", text: "Create an invoice" } },
      { sender: { id: "igsid_1" }, message: { mid: "mid_2", text: "send it" } },
    ])), CONTEXT);
    expect(response.status).toBe(200);
    expect(normalize).toHaveBeenCalledTimes(1);
    expect(handle).not.toHaveBeenCalled();
    await callbacks.shift()!();
    expect(handle.mock.calls.map(([message]) => message.messageId)).toEqual(["mid_1", "mid_2"]);
    expect(handle).toHaveBeenNthCalledWith(2, expect.objectContaining({ kind: "text", text: "send it" }), expect.objectContaining({ onProgress: expect.any(Function) }));
    expect(vi.mocked(instagramAdapter.send).mock.invocationCallOrder[0]).toBeLessThan(handle.mock.invocationCallOrder[1]!);
  });

  it("ignores echoes, audio and button postbacks without synthesizing assistant inputs", async () => {
    const rawBody = JSON.stringify({ entry: [{ messaging: [
      { sender: { id: "igsid_1" }, message: { mid: "echo", text: "yes", is_echo: true } },
      { sender: { id: "igsid_1" }, message: { mid: "audio", attachments: [{ type: "audio", payload: { url: "https://media.test/private" } }] } },
      { sender: { id: "igsid_1" }, postback: { title: "Send it", payload: "assistant:send:a" } },
    ] }] });
    expect((await POST(postReq(rawBody), CONTEXT)).status).toBe(200);
    expect(callbacks).toHaveLength(0);
    expect(handle).not.toHaveBeenCalled();
  });

  it("delivers progress and assistant confirmations as text-only Graph messages", async () => {
    vi.mocked(instagramAdapter.send).mockRestore();
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async () => new Response("{}"));
    const summary = "Create invoice for NGN 45,000? Reply yes to send, or change something to edit.";
    handle.mockImplementationOnce(async (_message, options) => {
      await options?.onProgress?.({ text: "One moment…" });
      return { text: summary, buttons: [{ id: "assistant:send:a", title: "Send it" }] };
    });
    await POST(postReq(payload()), CONTEXT);
    expect(fetchMock).not.toHaveBeenCalled();
    await callbacks.shift()!();
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ channel: "INSTAGRAM", kind: "text", text: "yes" }), expect.any(Object));
    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1]!.body as string))).toEqual([
      { recipient: { id: "igsid_1" }, message: { text: "One moment…" } },
      { recipient: { id: "igsid_1" }, message: { text: summary } },
    ]);
  });

  it("checks Graph failures without logging response bodies or suppressing another owner", async () => {
    vi.mocked(instagramAdapter.send).mockRestore();
    const fetchMock = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 10, message: "private response ig_token https://media.test/private" } }), { status: 400 }))
      .mockResolvedValueOnce(new Response("{}"));
    await POST(postReq(payload([
      { sender: { id: "private-owner" }, message: { mid: "mid_1", text: "private transcript" } },
      { sender: { id: "other-owner" }, message: { mid: "mid_2", text: "hello" } },
    ])), CONTEXT);
    await callbacks.shift()!();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith("[Instagram] send_failed", { status: 400, code: 10 });
    expect(console.warn).toHaveBeenCalledWith("[Messaging] delivery_failed", expect.objectContaining({ code: 10 }));
    const logs = JSON.stringify([
      ...vi.mocked(console.error).mock.calls, ...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.info).mock.calls,
    ]);
    for (const secret of ["private response", "ig_token", "media.test", "private-owner", "private transcript"]) expect(logs).not.toContain(secret);
  });
});

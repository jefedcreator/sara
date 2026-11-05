import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    INSTAGRAM_VERIFY_TOKEN: "ig_verify",
    INSTAGRAM_IG_ID: "IGID",
    INSTAGRAM_PAGE_TOKEN: "ig_token",
    META_APP_SECRET: "app_secret",
  },
}));

import { instagramAdapter } from "./index";

beforeEach(() => vi.clearAllMocks());

describe("verify", () => {
  it("echoes the challenge on a matching token", () => {
    const req = new Request("https://x/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=ig_verify&hub.challenge=C9");
    expect(instagramAdapter.verify(req).status).toBe(200);
  });
});

describe("normalizeInbound", () => {
  it("extracts text DMs", () => {
    const payload = { entry: [{ messaging: [
      { sender: { id: "igsid_1" }, recipient: { id: "IGID" }, message: { mid: "mid_1", text: "hi" } },
    ] }] };
    expect(instagramAdapter.normalizeInbound(payload)).toEqual([
      { channel: "INSTAGRAM", externalId: "igsid_1", kind: "text", text: "hi", messageId: "mid_1" },
    ]);
  });
  it("ignores echoes and non-text events", () => {
    const payload = { entry: [{ messaging: [
      { sender: { id: "x" }, message: { mid: "m", text: "hi", is_echo: true } },
      { sender: { id: "y" }, message: { mid: "n" } },
      { sender: { id: "z" }, message: { mid: "audio", attachments: [{ type: "audio", payload: { url: "https://example.com/audio.ogg" } }] } },
      { sender: { id: "z" }, postback: { title: "Send it", payload: "assistant:send:a" } },
    ] }] };
    expect(instagramAdapter.normalizeInbound(payload)).toEqual([]);
  });
});

describe("send", () => {
  it("preserves ordinary link text and emits no button payload", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}"));
    const text = "Invoice: https://sara.ng/invoices/123";
    await instagramAdapter.send("igsid_1", { text, buttons: [{ id: "assistant:send:a", title: "Send it" }] });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ recipient: { id: "igsid_1" }, message: { text } });
  });

  it("delivers long summaries intact in bounded chunks, then approval instructions", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async () => new Response("{}"));
    const summary = `${"Item: NGN 45,000\n".repeat(140)}Total: NGN 6,300,000`;
    const prompt = "Reply yes to send, or change something to edit.";
    const text = `${summary}\n\n${prompt}`;
    await instagramAdapter.send("igsid_1", { text });
    const chunks = fetchMock.mock.calls.map((call) => JSON.parse(call[1]!.body as string).message.text as string);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 1000)).toBe(true);
    expect(chunks.at(-1)).toBe(prompt);
    expect(chunks.slice(0, -1).join("")).toBe(`${summary}\n\n`);
  });

  it("never splits a surrogate pair even in a long unbroken string", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async () => new Response("{}"));
    const text = `a${"🎙️".repeat(800)}`;
    await instagramAdapter.send("igsid_1", { text });
    const chunks = fetchMock.mock.calls.map((call) => JSON.parse(call[1]!.body as string).message.text as string);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 1000 && !/[\uD800-\uDBFF]$/.test(chunk) && !/^[\uDC00-\uDFFF]/.test(chunk))).toBe(true);
  });

  it("keeps exactly 1000 characters together and preserves a word boundary above the limit", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async () => new Response("{}"));
    await instagramAdapter.send("igsid_1", { text: "x".repeat(1000) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    const text = `${"x".repeat(980)} NGN 45,000 in total today`;
    await instagramAdapter.send("igsid_1", { text });
    const chunks = fetchMock.mock.calls.map((call) => JSON.parse(call[1]!.body as string).message.text as string);
    expect(chunks.join("")).toBe(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.endsWith(" ")).toBe(true);
    expect(chunks.every((chunk) => chunk.length <= 1000)).toBe(true);
  });

  it("stops on summary failure before sending remaining chunks or approval instructions", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementationOnce(async () => new Response("{}"))
      .mockImplementationOnce(async () => new Response('{"error":{"code":10}}', { status: 400 }));
    const text = `${"x".repeat(2500)}\n\nReply yes to send, or change something to edit.`;
    await expect(instagramAdapter.send("igsid_1", { text })).resolves.toEqual({ ok: false, code: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((call) => !String(call[1]!.body).includes("Reply yes"))).toBe(true);
  });

  it("posts a message to the Graph API for the IG account", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await instagramAdapter.send("igsid_1", { text: "hello" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/IGID/messages",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as any).body);
    expect(body).toMatchObject({ recipient: { id: "igsid_1" }, message: { text: "hello" } });
  });
});

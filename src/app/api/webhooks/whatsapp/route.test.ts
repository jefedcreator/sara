import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/services/messaging/channels/whatsapp", () => ({
  whatsAppAdapter: { verify: vi.fn(), isAuthentic: vi.fn(), normalizeInbound: vi.fn(), send: vi.fn() },
}));
vi.mock("@/backend/services/messaging/engine", () => ({
  conversationEngine: { handle: vi.fn() },
}));

import { whatsAppAdapter } from "@/backend/services/messaging/channels/whatsapp";
import { conversationEngine } from "@/backend/services/messaging/engine";
import { POST } from "./route";

const mockedAdapter = whatsAppAdapter as any;
const mockedEngine = conversationEngine as any;
beforeEach(() => vi.clearAllMocks());

function postReq(body: unknown) {
  return new Request("https://x/api/webhooks/whatsapp", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/webhooks/whatsapp", () => {
  it("returns 403 on an invalid signature", async () => {
    mockedAdapter.isAuthentic.mockReturnValue(false);
    const res = await POST(postReq({}));
    expect(res.status).toBe(403);
    expect(mockedEngine.handle).not.toHaveBeenCalled();
  });

  it("processes messages, sends replies, returns 200", async () => {
    mockedAdapter.isAuthentic.mockReturnValue(true);
    mockedAdapter.normalizeInbound.mockReturnValue([
      { channel: "WHATSAPP", externalId: "234800", kind: "text", text: "1", messageId: "m1" },
    ]);
    mockedEngine.handle.mockResolvedValue({ text: "Customer's name?" });
    const res = await POST(postReq({ entry: [] }));
    expect(res.status).toBe(200);
    expect(mockedAdapter.send).toHaveBeenCalledWith("234800", { text: "Customer's name?" });
  });

  it("still returns 200 when processing throws", async () => {
    mockedAdapter.isAuthentic.mockReturnValue(true);
    mockedAdapter.normalizeInbound.mockImplementation(() => { throw new Error("boom"); });
    const res = await POST(postReq({}));
    expect(res.status).toBe(200);
  });

  it("passes audio metadata and button IDs to the engine and preserves outbound controls", async () => {
    mockedAdapter.isAuthentic.mockReturnValue(true);
    const messages = [
      { channel: "WHATSAPP", externalId: "234800", kind: "voice", mediaId: "media1", mime: "audio/ogg; codecs=opus", messageId: "m-audio" },
      { channel: "WHATSAPP", externalId: "234800", kind: "button", buttonId: "assistant:send:action_1", messageId: "m-button" },
    ];
    const reply = { text: "Create the invoice for NGN 45,000?", buttons: [
      { id: "assistant:send:action_1", title: "Send it" },
      { id: "assistant:change:action_1", title: "Change something" },
    ] };
    mockedAdapter.normalizeInbound.mockReturnValue(messages);
    mockedEngine.handle.mockResolvedValue(reply);
    const res = await POST(postReq({ entry: [] }));
    expect(res.status).toBe(200);
    for (const message of messages) expect(mockedEngine.handle).toHaveBeenCalledWith(message, expect.objectContaining({ onProgress: expect.any(Function) }));
    expect(mockedAdapter.send).toHaveBeenCalledTimes(2);
    expect(mockedAdapter.send).toHaveBeenCalledWith("234800", reply);
  });

  it("passes onProgress and sends intermediate loading message", async () => {
    mockedAdapter.isAuthentic.mockReturnValue(true);
    mockedAdapter.normalizeInbound.mockReturnValue([
      { channel: "WHATSAPP", externalId: "234800", kind: "text", text: "yes", messageId: "m1" },
    ]);

    mockedEngine.handle.mockImplementation(async (_msg: any, options: any) => {
      if (options?.onProgress) {
        await options.onProgress({ text: "Creating invoice... ⏳" });
      }
      return { text: "Invoice INV-1001 created ✅" };
    });

    const res = await POST(postReq({ entry: [] }));
    expect(res.status).toBe(200);
    expect(mockedAdapter.send).toHaveBeenNthCalledWith(1, "234800", { text: "Creating invoice... ⏳" });
    expect(mockedAdapter.send).toHaveBeenNthCalledWith(2, "234800", { text: "Invoice INV-1001 created ✅" });
  });
});

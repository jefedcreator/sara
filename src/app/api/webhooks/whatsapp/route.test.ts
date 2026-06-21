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
      { channel: "WHATSAPP", externalId: "234800", text: "1", messageId: "m1" },
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
});

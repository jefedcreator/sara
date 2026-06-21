import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    WHATSAPP_VERIFY_TOKEN: "verify_me",
    WHATSAPP_PHONE_NUMBER_ID: "PNID",
    WHATSAPP_TOKEN: "wa_token",
    META_APP_SECRET: "app_secret",
  },
}));

import { whatsAppAdapter } from "./index";

beforeEach(() => vi.clearAllMocks());

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
      { channel: "WHATSAPP", externalId: "234800", text: "hi", messageId: "wamid.1", displayName: "Ada" },
    ]);
  });
  it("ignores non-text messages", () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ from: "x", id: "1", type: "image" }] } }] }] };
    expect(whatsAppAdapter.normalizeInbound(payload)).toEqual([]);
  });
});

describe("send", () => {
  it("posts a text message to the Graph API", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await whatsAppAdapter.send("234800", { text: "hello" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/PNID/messages",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as any).body);
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "234800", type: "text", text: { body: "hello" } });
  });
});

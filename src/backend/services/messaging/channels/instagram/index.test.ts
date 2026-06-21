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
      { channel: "INSTAGRAM", externalId: "igsid_1", text: "hi", messageId: "mid_1" },
    ]);
  });
  it("ignores echoes and non-text events", () => {
    const payload = { entry: [{ messaging: [
      { sender: { id: "x" }, message: { mid: "m", text: "hi", is_echo: true } },
      { sender: { id: "y" }, message: { mid: "n" } },
    ] }] };
    expect(instagramAdapter.normalizeInbound(payload)).toEqual([]);
  });
});

describe("send", () => {
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

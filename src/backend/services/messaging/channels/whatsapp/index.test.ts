import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    WHATSAPP_VERIFY_TOKEN: "verify_me",
    WHATSAPP_PHONE_NUMBER_ID: "PNID",
    WHATSAPP_TOKEN: "wa_token",
    META_APP_SECRET: "app_secret",
  },
}));

import {
  extractFirstUrl,
  isScrapeableUrl,
  whatsAppAdapter,
} from "./index";

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

describe("isScrapeableUrl", () => {
  it("identifies public scrapeable urls", () => {
    expect(isScrapeableUrl("https://sara.ng/link")).toBe(true);
    expect(isScrapeableUrl("https://sara.84-12-92-46.sslip.io/link?t=abc")).toBe(true);
    expect(isScrapeableUrl("http://localhost:3000/link")).toBe(false);
    expect(isScrapeableUrl("http://127.0.0.1:3000/link")).toBe(false);
    expect(isScrapeableUrl("not-a-url")).toBe(false);
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
      { channel: "WHATSAPP", externalId: "234800", text: "hi", messageId: "wamid.1", displayName: "Ada" },
    ]);
  });
  it("ignores non-text messages", () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ from: "x", id: "1", type: "image" }] } }] }] };
    expect(whatsAppAdapter.normalizeInbound(payload)).toEqual([]);
  });
});

describe("send", () => {
  it("posts a text message to the Graph API without pre-scrape when no URL", async () => {
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
  });

  it("pre-scrapes public URLs to warm Meta cache before sending message", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await whatsAppAdapter.send("234800", {
      text: "👋 Welcome! Connect: https://sara.ng/link?t=abc",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Call 1: Pre-scrape Meta cache warming
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://graph.facebook.com/v21.0/?id=https%3A%2F%2Fsara.ng%2Flink%3Ft%3Dabc&scrape=true&access_token=wa_token",
    );
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "POST" });

    // Call 2: WhatsApp Cloud API message send
    expect(fetchMock.mock.calls[1]![0]).toBe(
      "https://graph.facebook.com/v21.0/PNID/messages",
    );
    const body = JSON.parse((fetchMock.mock.calls[1]![1] as any).body);
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      to: "234800",
      type: "text",
      text: {
        body: "👋 Welcome! Connect: https://sara.ng/link?t=abc",
        preview_url: true,
      },
    });
  });
});

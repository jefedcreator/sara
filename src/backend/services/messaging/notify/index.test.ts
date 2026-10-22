import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = { chatIdentity: { findMany: vi.fn() } };
  return { db };
});

const send = vi.fn();
const sendTemplate = vi.fn();
const mockedEnv = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock("@/env", () => ({ env: mockedEnv }));
vi.mock("../channels/whatsapp", () => ({
  whatsAppAdapter: { sendTemplate: (...args: unknown[]) => sendTemplate(...args) },
}));
vi.mock("../channels/registry", () => ({
  adapterFor: vi.fn(() => ({ send })),
}));

import { db } from "@/server/db";
import { adapterFor } from "../channels/registry";
import { ownerNotifier } from "./index";

const mockedDb = db as any;
beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue({ ok: true });
  sendTemplate.mockResolvedValue({ ok: true });
  delete mockedEnv.WHATSAPP_ALERT_TEMPLATE;
  mockedEnv.WHATSAPP_ALERT_TEMPLATE_LANGUAGE = "en";
});

const WINDOW_CLOSED = { ok: false, code: 131047 };

describe("ownerNotifier.notify", () => {
  it("sends to every linked identity via its adapter", async () => {
    mockedDb.chatIdentity.findMany.mockResolvedValue([
      { channel: "WHATSAPP", externalId: "234800" },
      { channel: "INSTAGRAM", externalId: "igsid_1" },
    ]);
    await ownerNotifier.notify("biz_1", "💰 Paid");
    expect(adapterFor).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith("234800", { text: "💰 Paid" });
    expect(send).toHaveBeenCalledWith("igsid_1", { text: "💰 Paid" });
  });

  it("no-ops when the business has no linked identity", async () => {
    mockedDb.chatIdentity.findMany.mockResolvedValue([]);
    await ownerNotifier.notify("biz_1", "hi");
    expect(send).not.toHaveBeenCalled();
  });

  it("continues when one send fails", async () => {
    mockedDb.chatIdentity.findMany.mockResolvedValue([
      { channel: "WHATSAPP", externalId: "a" },
      { channel: "WHATSAPP", externalId: "b" },
    ]);
    send.mockRejectedValueOnce(new Error("boom"));
    await ownerNotifier.notify("biz_1", "hi");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends the alert template when the 24-hour window is closed", async () => {
    mockedEnv.WHATSAPP_ALERT_TEMPLATE = "sara_alert";
    mockedDb.chatIdentity.findMany.mockResolvedValue([
      { channel: "WHATSAPP", externalId: "234800" },
    ]);
    send.mockResolvedValue(WINDOW_CLOSED);
    await ownerNotifier.notify("biz_1", "💰 Paid");
    expect(sendTemplate).toHaveBeenCalledWith("234800", {
      name: "sara_alert",
      language: "en",
      bodyParams: ["💰 Paid"],
    });
  });

  it("puts no line breaks in a template parameter", async () => {
    mockedEnv.WHATSAPP_ALERT_TEMPLATE = "sara_alert";
    mockedDb.chatIdentity.findMany.mockResolvedValue([
      { channel: "WHATSAPP", externalId: "234800" },
    ]);
    send.mockResolvedValue(WINDOW_CLOSED);
    await ownerNotifier.notify("biz_1", "a\nb");
    expect(sendTemplate).toHaveBeenCalledWith(
      "234800",
      expect.objectContaining({ bodyParams: ["a · b"] }),
    );
  });

  it("doesn't fall back without a template configured", async () => {
    mockedDb.chatIdentity.findMany.mockResolvedValue([
      { channel: "WHATSAPP", externalId: "234800" },
    ]);
    send.mockResolvedValue(WINDOW_CLOSED);
    await ownerNotifier.notify("biz_1", "hi");
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("doesn't fall back for other errors", async () => {
    mockedEnv.WHATSAPP_ALERT_TEMPLATE = "sara_alert";
    mockedDb.chatIdentity.findMany.mockResolvedValue([
      { channel: "WHATSAPP", externalId: "234800" },
    ]);
    send.mockResolvedValue({ ok: false, code: 100 });
    await ownerNotifier.notify("biz_1", "hi");
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});

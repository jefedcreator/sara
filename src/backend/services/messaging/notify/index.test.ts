import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = { chatIdentity: { findMany: vi.fn() } };
  return { db };
});

const send = vi.fn();
vi.mock("../channels/registry", () => ({
  adapterFor: vi.fn(() => ({ send })),
}));

import { db } from "@/server/db";
import { adapterFor } from "../channels/registry";
import { ownerNotifier } from "./index";

const mockedDb = db as any;
beforeEach(() => {
  vi.clearAllMocks();
});

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
});

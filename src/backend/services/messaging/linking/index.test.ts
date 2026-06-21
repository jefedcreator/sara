import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    chatLinkToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    chatIdentity: { upsert: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});

import { db } from "@/server/db";
import { BadRequestException } from "@/utils/exceptions";
import { linkingService } from "./index";

const mockedDb = db as any;
beforeEach(() => vi.clearAllMocks());

describe("linkingService", () => {
  it("issues and persists a token", async () => {
    mockedDb.chatLinkToken.create.mockResolvedValue({ token: "abc" });
    const token = await linkingService.issueToken("WHATSAPP", "234800");
    expect(typeof token).toBe("string");
    expect(mockedDb.chatLinkToken.create).toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    mockedDb.chatLinkToken.findUnique.mockResolvedValue({
      id: "t1", token: "abc", channel: "WHATSAPP", externalId: "234800",
      expiresAt: new Date(Date.now() - 1000), consumedAt: null,
    });
    await expect(linkingService.consumeToken("abc", "biz_1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("creates an identity and consumes a valid token", async () => {
    mockedDb.chatLinkToken.findUnique.mockResolvedValue({
      id: "t1", token: "abc", channel: "WHATSAPP", externalId: "234800",
      expiresAt: new Date(Date.now() + 60_000), consumedAt: null,
    });
    mockedDb.chatIdentity.upsert.mockResolvedValue({
      id: "id_1", businessId: "biz_1", channel: "WHATSAPP", externalId: "234800",
    });
    const identity = await linkingService.consumeToken("abc", "biz_1");
    expect(identity.businessId).toBe("biz_1");
    expect(mockedDb.chatLinkToken.update).toHaveBeenCalled();
  });
});

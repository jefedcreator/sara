import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    chatIdentity: { findUnique: vi.fn() },
    chatSession: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    processedChatMessage: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db };
});

import { db } from "@/server/db";
import { chatSessionService } from "./index";

const mockedDb = db as any;
beforeEach(() => {
  vi.resetAllMocks();
  mockedDb.$transaction.mockImplementation((callback: any) => callback(mockedDb));
  mockedDb.processedChatMessage.create.mockResolvedValue({});
  mockedDb.chatSession.update.mockResolvedValue({});
});

describe("chatSessionService", () => {
  it("returns null when no identity exists", async () => {
    mockedDb.chatIdentity.findUnique.mockResolvedValue(null);
    expect(
      await chatSessionService.findIdentity("WHATSAPP", "234800"),
    ).toBeNull();
  });

  it("reads what the business sells with the identity, for the menu", async () => {
    mockedDb.chatIdentity.findUnique.mockResolvedValue(null);
    await chatSessionService.findIdentity("WHATSAPP", "234800");
    expect(mockedDb.chatIdentity.findUnique).toHaveBeenCalledWith({
      where: { channel_externalId: { channel: "WHATSAPP", externalId: "234800" } },
      include: { session: true, business: { select: { sells: true } } },
    });
  });

  it("creates a session when one does not exist", async () => {
    mockedDb.chatSession.findUnique.mockResolvedValue(null);
    mockedDb.chatSession.create.mockResolvedValue({
      id: "sess_1",
      identityId: "id_1",
      state: "MAIN_MENU",
      context: null,
      lastProcessedMsgId: null,
      lastActiveAt: new Date(),
    });
    const session = await chatSessionService.getOrCreateSession("id_1");
    expect(session.state).toBe("MAIN_MENU");
    expect(mockedDb.chatSession.create).toHaveBeenCalled();
  });

  it("retrieves the winner when concurrent first deliveries create a session", async () => {
    mockedDb.chatSession.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "winner" });
    mockedDb.chatSession.create.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "P2002" }));
    await expect(chatSessionService.getOrCreateSession("identity-1")).resolves.toEqual({ id: "winner" });
  });

  it("treats a session older than 24h as stale", () => {
    expect(
      chatSessionService.isStale({
        lastActiveAt: new Date(Date.now() - 25 * 3600 * 1000),
      } as any),
    ).toBe(true);
    expect(
      chatSessionService.isStale({ lastActiveAt: new Date() } as any),
    ).toBe(false);
  });

  describe("claimMessage", () => {
    it("durably claims a message and keeps lastProcessedMsgId current", async () => {
      const claimed = await chatSessionService.claimMessage("sess_1", "m1");

      expect(claimed).toBe(true);
      expect(mockedDb.processedChatMessage.create).toHaveBeenCalledWith({
        data: { sessionId: "sess_1", messageId: "m1" },
      });
      expect(mockedDb.chatSession.update).toHaveBeenCalledWith({
        where: { id: "sess_1" },
        data: { lastProcessedMsgId: "m1", lastActiveAt: expect.any(Date) },
      });
    });

    it("claims interleaved message IDs only once", async () => {
      const seen = new Set<string>();
      mockedDb.processedChatMessage.create.mockImplementation(
        async ({ data }: any) => {
          const key = `${data.sessionId}:${data.messageId}`;
          if (seen.has(key)) {
            throw Object.assign(new Error("duplicate"), { code: "P2002" });
          }
          seen.add(key);
          return data as never;
        },
      );

      expect(await chatSessionService.claimMessage("s1", "m1")).toBe(true);
      expect(await chatSessionService.claimMessage("s1", "m2")).toBe(true);
      expect(await chatSessionService.claimMessage("s1", "m1")).toBe(false);
      expect(mockedDb.chatSession.update).toHaveBeenCalledTimes(2);
    });

    it("returns false only for a duplicate unique constraint", async () => {
      mockedDb.processedChatMessage.create.mockRejectedValue(
        Object.assign(new Error("duplicate"), { code: "P2002" }),
      );

      await expect(
        chatSessionService.claimMessage("sess_1", "m1"),
      ).resolves.toBe(false);
      expect(mockedDb.chatSession.update).not.toHaveBeenCalled();
    });

    it("rethrows a database outage instead of silently dropping the message", async () => {
      mockedDb.processedChatMessage.create.mockRejectedValue(
        Object.assign(new Error("connection lost"), { code: "P1001" }),
      );

      await expect(
        chatSessionService.claimMessage("sess_1", "m1"),
      ).rejects.toThrow("connection lost");
      expect(mockedDb.chatSession.update).not.toHaveBeenCalled();
    });
  });
});

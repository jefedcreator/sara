import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    chatIdentity: { findUnique: vi.fn() },
    chatSession: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  };
  return { db };
});

import { db } from "@/server/db";
import { chatSessionService } from "./index";

const mockedDb = db as any;
beforeEach(() => vi.clearAllMocks());

describe("chatSessionService", () => {
  it("returns null when no identity exists", async () => {
    mockedDb.chatIdentity.findUnique.mockResolvedValue(null);
    expect(await chatSessionService.findIdentity("WHATSAPP", "234800")).toBeNull();
  });

  it("creates a session when one does not exist", async () => {
    mockedDb.chatSession.findUnique.mockResolvedValue(null);
    mockedDb.chatSession.create.mockResolvedValue({
      id: "sess_1", identityId: "id_1", state: "MAIN_MENU",
      context: null, lastProcessedMsgId: null, lastActiveAt: new Date(),
    });
    const session = await chatSessionService.getOrCreateSession("id_1");
    expect(session.state).toBe("MAIN_MENU");
    expect(mockedDb.chatSession.create).toHaveBeenCalled();
  });

  it("treats a session older than 24h as stale", () => {
    expect(chatSessionService.isStale({ lastActiveAt: new Date(Date.now() - 25 * 3600 * 1000) } as any)).toBe(true);
    expect(chatSessionService.isStale({ lastActiveAt: new Date() } as any)).toBe(false);
  });

  describe("claimMessage", () => {
    it("returns true when it atomically claims a new messageId", async () => {
      mockedDb.chatSession.updateMany.mockResolvedValue({ count: 1 });
      const claimed = await chatSessionService.claimMessage("sess_1", "m1");
      expect(claimed).toBe(true);
      expect(mockedDb.chatSession.updateMany).toHaveBeenCalledWith({
        where: { id: "sess_1", NOT: { lastProcessedMsgId: "m1" } },
        data: { lastProcessedMsgId: "m1", lastActiveAt: expect.any(Date) },
      });
    });

    it("returns false when the messageId was already claimed (duplicate)", async () => {
      mockedDb.chatSession.updateMany.mockResolvedValue({ count: 0 });
      const claimed = await chatSessionService.claimMessage("sess_1", "m1");
      expect(claimed).toBe(false);
    });
  });
});

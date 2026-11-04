import { db } from "@/server/db";
import {
  Prisma,
  type BusinessSells,
  type ChatChannel,
  type ChatIdentity,
  type ChatSession,
} from "@prisma/client";

/** A linked chat, its session, and what its business sells (which picks the menu). */
export type IdentityWithSession = ChatIdentity & {
  session: ChatSession | null;
  business: { sells: BusinessSells };
};

const STALE_MS = 24 * 60 * 60 * 1000;

class ChatSessionService {
  async findIdentity(
    channel: ChatChannel,
    externalId: string,
  ): Promise<IdentityWithSession | null> {
    return db.chatIdentity.findUnique({
      where: { channel_externalId: { channel, externalId } },
      include: { session: true, business: { select: { sells: true } } },
    });
  }

  async getOrCreateSession(identityId: string): Promise<ChatSession> {
    const existing = await db.chatSession.findUnique({ where: { identityId } });
    if (existing) return existing;
    try {
      return await db.chatSession.create({ data: { identityId } });
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") throw error;
      // Concurrent first deliveries may create the same identity session.
      const winner = await db.chatSession.findUnique({ where: { identityId } });
      if (!winner) throw error;
      return winner;
    }
  }

  async save(
    sessionId: string,
    data: {
      state: string;
      context: Prisma.InputJsonValue | null;
      lastProcessedMsgId: string;
    },
  ): Promise<void> {
    await db.chatSession.update({
      where: { id: sessionId },
      data: {
        state: data.state,
        context: data.context ?? Prisma.JsonNull,
        lastProcessedMsgId: data.lastProcessedMsgId,
        lastActiveAt: new Date(),
      },
    });
  }

  isStale(session: ChatSession): boolean {
    return Date.now() - new Date(session.lastActiveAt).getTime() > STALE_MS;
  }

  async claimMessage(sessionId: string, messageId: string): Promise<boolean> {
    try {
      await db.$transaction(async (tx) => {
        await tx.processedChatMessage.create({ data: { sessionId, messageId } });
        // Keep the compatibility field in the same commit so an outage cannot
        // leave a claimed message whose processing never started.
        await tx.chatSession.update({
          where: { id: sessionId },
          data: { lastProcessedMsgId: messageId, lastActiveAt: new Date() },
        });
      });
      return true;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return false;
      throw error;
    }
  }
}

export const chatSessionService = new ChatSessionService();

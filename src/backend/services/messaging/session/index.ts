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
    return db.chatSession.create({ data: { identityId } });
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
    const result = await db.chatSession.updateMany({
      where: {
        id: sessionId,
        OR: [
          { lastProcessedMsgId: null },
          { lastProcessedMsgId: { not: messageId } },
        ],
      },
      data: { lastProcessedMsgId: messageId, lastActiveAt: new Date() },
    });
    return result.count === 1;
  }
}

export const chatSessionService = new ChatSessionService();

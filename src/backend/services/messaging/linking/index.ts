import { db } from "@/server/db";
import { BadRequestException } from "@/utils/exceptions";
import type { ChatChannel, ChatIdentity } from "@prisma/client";
import crypto from "node:crypto";
import { appBaseUrl } from "@/utils/url";

const TOKEN_TTL_MS = 15 * 60 * 1000;

class LinkingService {
  async issueToken(channel: ChatChannel, externalId: string): Promise<string> {
    const token = crypto.randomBytes(24).toString("hex");
    await db.chatLinkToken.create({
      data: {
        token,
        channel,
        externalId,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });
    return token;
  }

  buildLinkUrl(token: string): string {
    return `${appBaseUrl()}/link?t=${token}`;
  }

  async consumeToken(token: string, businessId: string): Promise<ChatIdentity> {
    return db.$transaction(async (tx) => {
      const record = await tx.chatLinkToken.findUnique({ where: { token } });
      if (!record) {
        throw new BadRequestException("Invalid link. Please request a new one.");
      }
      if (record.consumedAt) {
        throw new BadRequestException("This link has already been used.");
      }
      if (record.expiresAt < new Date()) {
        throw new BadRequestException("This link has expired. Please request a new one.");
      }

      const identity = await tx.chatIdentity.upsert({
        where: {
          channel_externalId: {
            channel: record.channel,
            externalId: record.externalId,
          },
        },
        create: {
          businessId,
          channel: record.channel,
          externalId: record.externalId,
        },
        update: { businessId },
      });

      await tx.chatLinkToken.update({
        where: { token },
        data: { consumedAt: new Date() },
      });

      return identity;
    });
  }
}

export const linkingService = new LinkingService();

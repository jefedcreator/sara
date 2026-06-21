import type { ChatChannel } from "@prisma/client";

export type InboundMessage = {
  channel: ChatChannel;
  externalId: string;
  text: string;
  messageId: string;
  displayName?: string;
};

export type OutboundMessage = {
  text: string;
};

export interface ChannelAdapter {
  channel: ChatChannel;
  verify(req: Request): Response;
  isAuthentic(req: Request, rawBody: string): boolean;
  normalizeInbound(payload: unknown): InboundMessage[];
  send(externalId: string, message: OutboundMessage): Promise<void>;
}

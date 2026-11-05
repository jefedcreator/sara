import type { ChatChannel } from "@prisma/client";

type InboundBase = {
  channel: ChatChannel;
  externalId: string;
  messageId: string;
  displayName?: string;
};

export type InboundMessage = InboundBase & (
  | { kind: "text"; text: string }
  | { kind: "voice"; mediaId: string; mime: string | null }
  | { kind: "button"; buttonId: string }
);

export type OutboundMessage = {
  text: string;
  buttons?: { id: string; title: string }[];
};

/** `code` is the platform's error code (Meta's `error.code`), when it gave one. */
export type SendResult = { ok: true } | { ok: false; code: number | null };

export interface ChannelAdapter {
  channel: ChatChannel;
  verify(req: Request): Response;
  isAuthentic(req: Request, rawBody: string): boolean;
  normalizeInbound(payload: unknown): InboundMessage[];
  send(externalId: string, message: OutboundMessage): Promise<SendResult>;
}

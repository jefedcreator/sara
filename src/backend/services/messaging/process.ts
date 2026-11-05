import type {
  ChannelAdapter,
  InboundMessage,
  OutboundMessage,
} from "./channels/types";
import { conversationEngine } from "./engine";

async function deliver(
  adapter: ChannelAdapter,
  message: InboundMessage,
  reply: OutboundMessage,
  phase: "progress" | "final",
): Promise<void> {
  const startedAt = Date.now();
  const event = { channel: message.channel, messageId: message.messageId, phase };
  try {
    const result = await adapter.send(message.externalId, reply);
    if (!result.ok) {
      console.warn("[Messaging] delivery_failed", {
        ...event,
        code: result.code,
        elapsedMs: Date.now() - startedAt,
      });
      return;
    }
    console.info("[Messaging] delivery_sent", {
      ...event,
      elapsedMs: Date.now() - startedAt,
    });
  } catch {
    // Adapter errors can contain response bodies, URLs or credentials.
    console.warn("[Messaging] delivery_failed", {
      ...event,
      code: "SEND_EXCEPTION",
      elapsedMs: Date.now() - startedAt,
    });
  }
}

/** Batch ordering only; the conversation lease coordinates separate webhooks. */
export async function processInboundBatch(
  adapter: ChannelAdapter,
  messages: InboundMessage[],
): Promise<void> {
  const channels = new Map<InboundMessage["channel"], Map<string, InboundMessage[]>>();
  for (const message of messages) {
    let senders = channels.get(message.channel);
    if (!senders) {
      senders = new Map();
      channels.set(message.channel, senders);
    }
    const group = senders.get(message.externalId);
    if (group) group.push(message);
    else senders.set(message.externalId, [message]);
  }

  const groups = Array.from(channels.values()).flatMap((senders) =>
    Array.from(senders.values()),
  );
  await Promise.all(
    groups.map(async (group) => {
      for (const message of group) {
        const startedAt = Date.now();
        const event = { channel: message.channel, messageId: message.messageId };
        try {
          const reply = await conversationEngine.handle(message, {
            onProgress: async (progress) => {
              await deliver(adapter, message, progress, "progress");
            },
          });
          if (reply) await deliver(adapter, message, reply, "final");
          console.info("[Messaging] message_processed", {
            ...event,
            elapsedMs: Date.now() - startedAt,
          });
        } catch {
          console.error("[Messaging] processing_failed", {
            ...event,
            code: "PROCESSING_EXCEPTION",
            elapsedMs: Date.now() - startedAt,
          });
        }
      }
    }),
  );
}

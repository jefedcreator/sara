import { env } from "@/env";
import type { ChatChannel } from "@prisma/client";
import crypto from "node:crypto";
import type { ChannelAdapter, InboundMessage, OutboundMessage } from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";

class WhatsAppAdapter implements ChannelAdapter {
  channel: ChatChannel = "WHATSAPP";

  verify(req: Request): Response {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (mode === "subscribe" && token && token === env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  isAuthentic(req: Request, rawBody: string): boolean {
    const secret = env.META_APP_SECRET;
    if (!secret) return false;
    const signature = req.headers.get("x-hub-signature-256");
    if (!signature) return false;
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  normalizeInbound(payload: unknown): InboundMessage[] {
    const out: InboundMessage[] = [];
    const body = payload as any;
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};
        const contactName = value?.contacts?.[0]?.profile?.name as string | undefined;
        for (const msg of value?.messages ?? []) {
          if (msg?.type !== "text" || !msg?.text?.body) continue;
          out.push({
            channel: "WHATSAPP",
            externalId: String(msg.from),
            text: String(msg.text.body),
            messageId: String(msg.id),
            displayName: contactName,
          });
        }
      }
    }
    return out;
  }

  async send(externalId: string, message: OutboundMessage): Promise<void> {
    const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: externalId,
        type: "text",
        text: { body: message.text },
      }),
    });
    if (!res.ok) {
      console.error(`[WhatsApp] send failed: ${res.status} ${await res.text()}`);
    }
  }
}

export const whatsAppAdapter = new WhatsAppAdapter();

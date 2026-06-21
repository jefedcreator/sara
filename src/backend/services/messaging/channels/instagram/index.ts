import { env } from "@/env";
import type { ChatChannel } from "@prisma/client";
import crypto from "node:crypto";
import type { ChannelAdapter, InboundMessage, OutboundMessage } from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";

class InstagramAdapter implements ChannelAdapter {
  channel: ChatChannel = "INSTAGRAM";

  verify(req: Request): Response {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (mode === "subscribe" && token && token === env.INSTAGRAM_VERIFY_TOKEN) {
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
      for (const event of entry?.messaging ?? []) {
        const msg = event?.message;
        if (!msg || msg.is_echo || !msg.text) continue;
        out.push({
          channel: "INSTAGRAM",
          externalId: String(event.sender?.id),
          text: String(msg.text),
          messageId: String(msg.mid),
        });
      }
    }
    return out;
  }

  async send(externalId: string, message: OutboundMessage): Promise<void> {
    const res = await fetch(`${GRAPH}/${env.INSTAGRAM_IG_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.INSTAGRAM_PAGE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: externalId },
        message: { text: message.text },
      }),
    });
    if (!res.ok) {
      console.error(`[Instagram] send failed: ${res.status} ${await res.text()}`);
    }
  }
}

export const instagramAdapter = new InstagramAdapter();

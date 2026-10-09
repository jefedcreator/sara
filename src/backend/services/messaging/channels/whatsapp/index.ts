import { env } from "@/env";
import type { ChatChannel } from "@prisma/client";
import crypto from "node:crypto";
import type { ChannelAdapter, InboundMessage, OutboundMessage } from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";

export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/i);
  if (!match) return null;
  return match[0].replace(/[.,;:!?)]+$/, "");
}

export function isScrapeableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.startsWith("192.168.") ||
      host.startsWith("10.")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function warmMetaScraperCache(
  url: string,
  token: string,
): Promise<void> {
  const endpoint = `${GRAPH}/?id=${encodeURIComponent(url)}&scrape=true&access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(
        `[WhatsApp] Pre-scrape returned status ${res.status} for ${url}`,
      );
    } else {
      console.log(`[WhatsApp] Warmed preview cache for ${url}`);
    }
  } catch (err) {
    console.warn(`[WhatsApp] Pre-scrape warning for ${url}:`, err);
  }
}

class WhatsAppAdapter implements ChannelAdapter {
  channel: ChatChannel = "WHATSAPP";

  private getVerifyToken(): string | undefined {
    return (env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN)?.trim();
  }

  verify(req: Request): Response {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    const expectedToken = this.getVerifyToken();

    if (
      mode === "subscribe" &&
      token &&
      expectedToken &&
      token.trim() === expectedToken
    ) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new Response("Forbidden", { status: 403 });
  }

  isAuthentic(req: Request, rawBody: string): boolean {
    const secret = env.META_APP_SECRET || process.env.META_APP_SECRET;
    if (!secret) return false;
    const signature = req.headers.get("x-hub-signature-256");
    if (!signature) return false;
    const expected =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
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
        const contactName = value?.contacts?.[0]?.profile?.name as
          | string
          | undefined;
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
    const phoneId = env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = env.WHATSAPP_TOKEN || process.env.WHATSAPP_TOKEN;

    const url = extractFirstUrl(message.text);
    if (url && token && isScrapeableUrl(url)) {
      await warmMetaScraperCache(url, token);
    }

    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: externalId,
        type: "text",
        text: {
          body: message.text,
          preview_url: true,
        },
      }),
    });
    if (!res.ok) {
      console.error(
        `[WhatsApp] send failed: ${res.status} ${await res.text()}`,
      );
    } else {
      console.log(`[WhatsApp] Sent message to ${externalId}`);
    }
  }
}

export const whatsAppAdapter = new WhatsAppAdapter();

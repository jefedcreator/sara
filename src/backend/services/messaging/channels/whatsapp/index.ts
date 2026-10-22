import { env } from "@/env";
import { primeLinkCard } from "@/server/link-cards";
import type { ChatChannel } from "@prisma/client";
import crypto from "node:crypto";
import type {
  ChannelAdapter,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";

export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/i);
  if (!match) return null;
  return match[0].replace(/[.,;:!?)]+$/, "");
}

function errorCode(raw: string): number | null {
  try {
    const code = (JSON.parse(raw) as { error?: { code?: unknown } })?.error?.code;
    return typeof code === "number" ? code : null;
  } catch {
    return null;
  }
}

/** Meta refuses newlines, tabs and runs of 4+ spaces in a template parameter. */
function templateParam(text: string): string {
  return text
    .replace(/\s*[\r\n]+\s*/g, " · ")
    .replace(/\t/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim();
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

  async send(externalId: string, message: OutboundMessage): Promise<SendResult> {
    // Meta builds the preview as it sends, and a card that comes late goes
    // out small: render it first so the card route answers from memory.
    const url = extractFirstUrl(message.text);
    if (url) await primeLinkCard(url);

    return this.post(externalId, {
      messaging_product: "whatsapp",
      to: externalId,
      type: "text",
      text: {
        body: message.text,
        preview_url: true,
      },
    });
  }

  /**
   * A pre-approved template, the only thing WhatsApp lets a business send once
   * the customer's 24-hour window has closed.
   */
  async sendTemplate(
    externalId: string,
    template: { name: string; language: string; bodyParams: string[] },
  ): Promise<SendResult> {
    return this.post(externalId, {
      messaging_product: "whatsapp",
      to: externalId,
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language },
        components: [
          {
            type: "body",
            parameters: template.bodyParams.map((text) => ({
              type: "text",
              text: templateParam(text),
            })),
          },
        ],
      },
    });
  }

  private async post(externalId: string, payload: unknown): Promise<SendResult> {
    const phoneId = env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = env.WHATSAPP_TOKEN || process.env.WHATSAPP_TOKEN;

    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const raw = await res.text();
      console.error(`[WhatsApp] send failed: ${res.status} ${raw}`);
      return { ok: false, code: errorCode(raw) };
    }
    console.log(`[WhatsApp] Sent message to ${externalId}`);
    return { ok: true };
  }
}

export const whatsAppAdapter = new WhatsAppAdapter();

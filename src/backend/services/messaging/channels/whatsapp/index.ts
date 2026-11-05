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
          if (typeof msg?.from !== "string" || !msg.from ||
              typeof msg?.id !== "string" || !msg.id) continue;
          const base = {
            channel: "WHATSAPP" as const,
            externalId: msg.from as string,
            messageId: msg.id as string,
            ...(typeof contactName === "string" ? { displayName: contactName } : {}),
          };
          if (msg.type === "text" && typeof msg.text?.body === "string" && msg.text.body) {
            out.push({ ...base, kind: "text", text: msg.text.body });
          } else if (msg.type === "audio" && typeof msg.audio?.id === "string" && msg.audio.id) {
            out.push({
              ...base, kind: "voice", mediaId: msg.audio.id,
              mime: typeof msg.audio.mime_type === "string" ? msg.audio.mime_type : null,
            });
          } else if (msg.type === "interactive" && msg.interactive?.type === "button_reply") {
            const id: unknown = msg.interactive.button_reply?.id;
            if (typeof id === "string" && id.length > 0 && id.length <= 256 &&
                id.trim() === id && !/[\u0000-\u001f\u007f]/.test(id)) {
              out.push({ ...base, kind: "button", buttonId: id });
            }
          }
        }
      }
    }
    return out;
  }

  async send(externalId: string, message: OutboundMessage): Promise<SendResult> {
    const buttons = message.buttons;
    if (buttons?.length) {
      if (buttons.length > 3 || new Set(buttons.map(({ id }) => id)).size !== buttons.length ||
          buttons.some(({ id, title }) => !id || id.length > 256 || id.trim() !== id ||
            /[\u0000-\u001f\u007f]/.test(id) || !title.trim() || Array.from(title).length > 20)) {
        throw new Error("WHATSAPP_INVALID_BUTTONS");
      }
      if (message.text.length > 4_096) throw new Error("WHATSAPP_MESSAGE_TOO_LONG");
      let body = message.text;
      if (body.length > 1_024) {
        const summary = await this.send(externalId, { text: message.text });
        if (!summary.ok) return summary;
        body = "Use the summary above.";
      }
      return this.post(externalId, {
        messaging_product: "whatsapp", to: externalId, type: "interactive",
        interactive: {
          type: "button", body: { text: body },
          action: { buttons: buttons.map(({ id, title }) => ({ type: "reply", reply: { id, title } })) },
        },
      });
    }
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

  private async post(_externalId: string, payload: unknown): Promise<SendResult> {
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
      const code = errorCode(raw);
      console.error("[WhatsApp] send_failed", { status: res.status, code });
      return { ok: false, code };
    }
    console.info("[WhatsApp] message_sent", { status: res.status });
    return { ok: true };
  }
}

export const whatsAppAdapter = new WhatsAppAdapter();

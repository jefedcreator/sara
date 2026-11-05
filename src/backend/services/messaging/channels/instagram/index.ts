import { env } from "@/env";
import type { ChatChannel } from "@prisma/client";
import crypto from "node:crypto";
import type {
  ChannelAdapter,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";
const TEXT_CHUNK_LIMIT = 1_000;
const APPROVAL_PROMPT = "Reply yes to send, or change something to edit.";

/** Preserve every character, favouring a line/word boundary and never splitting a surrogate pair. */
function textChunks(text: string): string[] {
  const chunks: string[] = [];
  while (text.length > TEXT_CHUNK_LIMIT) {
    let end = TEXT_CHUNK_LIMIT;
    const boundary = Math.max(text.lastIndexOf("\n", end - 1), text.lastIndexOf(" ", end - 1));
    if (boundary >= end / 2) end = boundary + 1;
    if (/[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end]!)) end--;
    chunks.push(text.slice(0, end));
    text = text.slice(end);
  }
  if (text) chunks.push(text);
  return chunks;
}

function errorCode(raw: string): number | null {
  try {
    const code = (JSON.parse(raw) as { error?: { code?: unknown } })?.error?.code;
    return typeof code === "number" ? code : null;
  } catch {
    return null;
  }
}

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
        if (!msg || msg.is_echo || typeof msg.text !== "string" || !msg.text ||
            typeof event.sender?.id !== "string" || !event.sender.id ||
            typeof msg.mid !== "string" || !msg.mid) continue;
        out.push({
          channel: "INSTAGRAM",
          kind: "text",
          externalId: String(event.sender?.id),
          text: String(msg.text),
          messageId: String(msg.mid),
        });
      }
    }
    return out;
  }

  async send(externalId: string, message: OutboundMessage): Promise<SendResult> {
    // For long approvals, the prompt is a final delivery after the complete
    // summary. A failed chunk must never leave an invitation to approve it.
    const separatePrompt = message.text.length > TEXT_CHUNK_LIMIT && message.text.endsWith(APPROVAL_PROMPT);
    const summary = separatePrompt ? message.text.slice(0, -APPROVAL_PROMPT.length) : message.text;
    const chunks = textChunks(summary);
    if (separatePrompt) chunks.push(APPROVAL_PROMPT);
    if (!chunks.length) chunks.push("");
    for (const chunk of chunks) {
      const result = await this.postText(externalId, chunk);
      if (!result.ok) return result;
    }
    return { ok: true };
  }

  private async postText(externalId: string, text: string): Promise<SendResult> {
    const res = await fetch(`${GRAPH}/${env.INSTAGRAM_IG_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.INSTAGRAM_PAGE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: externalId },
        message: { text },
      }),
    });
    if (!res.ok) {
      const raw = await res.text();
      console.error(`[Instagram] send failed: ${res.status} ${raw}`);
      return { ok: false, code: errorCode(raw) };
    }
    return { ok: true };
  }
}

export const instagramAdapter = new InstagramAdapter();

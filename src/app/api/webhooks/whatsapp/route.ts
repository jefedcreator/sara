import { whatsAppAdapter } from "@/backend/services/messaging/channels/whatsapp";
import { conversationEngine } from "@/backend/services/messaging/engine";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_LOGS = 30;
type WebhookLog = {
  id: string;
  timestamp: string;
  type: string;
  data: unknown;
};
const webhookLogs: WebhookLog[] = [];

function recordLog(type: string, data: unknown) {
  webhookLogs.unshift({
    id: Math.random().toString(36).slice(2),
    timestamp: new Date().toISOString(),
    type,
    data,
  });
  if (webhookLogs.length > MAX_LOGS) webhookLogs.pop();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("debug") === "1") {
    const token = url.searchParams.get("token");
    const expected = (process.env.WHATSAPP_VERIFY_TOKEN ?? "").trim();
    if (!expected || token !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ logs: webhookLogs });
  }
  return whatsAppAdapter.verify(request);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!whatsAppAdapter.isAuthentic(request, rawBody)) {
    console.warn("[WhatsApp Webhook] Invalid signature", {
      hasSignature: !!signature,
    });
    recordLog("auth_failed", {
      hasSignature: !!signature,
      signaturePrefix: signature?.slice(0, 15),
      bodyPreview: rawBody.slice(0, 100),
    });
    return NextResponse.json({ message: "Invalid webhook signature" }, { status: 403 });
  }

  try {
    const payload = JSON.parse(rawBody) as unknown;
    const messages = whatsAppAdapter.normalizeInbound(payload);

    recordLog("inbound_received", {
      messageCount: messages.length,
      messages: messages.map((m) => ({
        from: m.externalId,
        text: m.text,
        id: m.messageId,
      })),
      rawPreview: rawBody.slice(0, 200),
    });

    console.log(`[WhatsApp Webhook] Received ${messages.length} message(s)`);

    await Promise.all(
      messages.map(async (message) => {
        console.log(`[WhatsApp Webhook] Handling message from ${message.externalId}: "${message.text}"`);
        const reply = await conversationEngine.handle(message);
        if (reply) {
          console.log(`[WhatsApp Webhook] Sending reply to ${message.externalId}`);
          await whatsAppAdapter.send(message.externalId, reply);
          recordLog("outbound_sent", {
            to: message.externalId,
            replyText: reply.text,
          });
        } else {
          recordLog("no_reply", {
            from: message.externalId,
            text: message.text,
          });
        }
      }),
    );
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[WhatsApp Webhook] Error:", errorMsg);
    recordLog("error", { error: errorMsg });
  }

  return NextResponse.json({ status: "ok" }, { status: 200 });
}

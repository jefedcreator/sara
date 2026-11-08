import { withMiddleware } from "@/backend/middleware";
import { whatsAppAdapter } from "@/backend/services/messaging/channels/whatsapp";
import { processInboundBatch } from "@/backend/services/messaging/process";
import { env } from "@/env";
import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

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

export const GET = withMiddleware<unknown>(async (request) => {
  const url = new URL(request.url);
  if (url.searchParams.get("debug") === "1") {
    const token = url.searchParams.get("token");
    const expected = env.WHATSAPP_VERIFY_TOKEN?.trim() ?? "";
    if (!expected || token !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ logs: webhookLogs });
  }
  return whatsAppAdapter.verify(request);
}, []);

export const POST = withMiddleware<unknown>(async (request) => {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!whatsAppAdapter.isAuthentic(request, rawBody)) {
    console.warn("[WhatsApp Webhook] Invalid signature", {
      hasSignature: !!signature,
    });
    recordLog("auth_failed", {
      hasSignature: !!signature,
    });
    return NextResponse.json({ message: "Invalid webhook signature" }, { status: 403 });
  }

  try {
    const payload = JSON.parse(rawBody) as unknown;
    const messages = whatsAppAdapter.normalizeInbound(payload);

    recordLog("inbound_received", {
      messageCount: messages.length,
      messageIds: messages.map((message) => message.messageId),
    });

    if (messages.length) {
      after(async () => {
        const startedAt = Date.now();
        await processInboundBatch(whatsAppAdapter, messages);
        recordLog("batch_processed", {
          messageCount: messages.length,
          elapsedMs: Date.now() - startedAt,
        });
      });
    }
  } catch {
    console.error("[WhatsApp Webhook] payload_rejected", { code: "INVALID_PAYLOAD" });
    recordLog("payload_rejected", { code: "INVALID_PAYLOAD" });
  }

  return NextResponse.json({ status: "ok" }, { status: 200 });
}, []);

import { instagramAdapter } from "@/backend/services/messaging/channels/instagram";
import { processInboundBatch } from "@/backend/services/messaging/process";
import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  return instagramAdapter.verify(request);
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!instagramAdapter.isAuthentic(request, rawBody)) {
    return NextResponse.json({ message: "Invalid webhook signature" }, { status: 403 });
  }

  try {
    const payload = JSON.parse(rawBody) as unknown;
    const messages = instagramAdapter.normalizeInbound(payload);
    if (messages.length) {
      after(async () => {
        await processInboundBatch(instagramAdapter, messages);
      });
    }
  } catch {
    console.error("[Instagram Webhook] payload_rejected", { code: "INVALID_PAYLOAD" });
  }

  return NextResponse.json({ status: "ok" }, { status: 200 });
}

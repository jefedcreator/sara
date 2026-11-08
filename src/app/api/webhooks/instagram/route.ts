import { withMiddleware } from "@/backend/middleware";
import { instagramAdapter } from "@/backend/services/messaging/channels/instagram";
import { processInboundBatch } from "@/backend/services/messaging/process";
import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = withMiddleware<unknown>(
  async (request) => instagramAdapter.verify(request),
  [],
);

export const POST = withMiddleware<unknown>(async (request) => {
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
}, []);

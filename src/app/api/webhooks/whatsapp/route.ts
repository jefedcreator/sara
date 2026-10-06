import { whatsAppAdapter } from "@/backend/services/messaging/channels/whatsapp";
import { conversationEngine } from "@/backend/services/messaging/engine";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return whatsAppAdapter.verify(request);
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!whatsAppAdapter.isAuthentic(request, rawBody)) {
    return NextResponse.json({ message: "Invalid webhook signature" }, { status: 403 });
  }

  try {
    const payload = JSON.parse(rawBody) as unknown;
    const messages = whatsAppAdapter.normalizeInbound(payload);
    await Promise.all(
      messages.map(async (message) => {
        const reply = await conversationEngine.handle(message);
        if (reply) await whatsAppAdapter.send(message.externalId, reply);
      }),
    );
  } catch (error: any) {
    console.error("[WhatsApp Webhook] Error:", error?.message ?? error);
  }

  return NextResponse.json({ status: "ok" }, { status: 200 });
}

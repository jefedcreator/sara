import {
  paystackService,
  type PaystackWebhookEvent,
} from "@/backend/services/paystack";
import { db } from "@/server/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * @description Paystack webhook endpoint for payment event notifications.
 *              Validates the webhook signature, then processes the event.
 */
export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-paystack-signature");

    if (!signature) {
      return NextResponse.json(
        { message: "Missing webhook signature" },
        { status: 400 },
      );
    }

    // Verify webhook authenticity
    const isValid = paystackService.verifyWebhookSignature(rawBody, signature);

    if (!isValid) {
      return NextResponse.json(
        { message: "Invalid webhook signature" },
        { status: 401 },
      );
    }

    const event = JSON.parse(rawBody) as PaystackWebhookEvent;

    // Handle charge.success events
    if (event.event === "charge.success") {
      const { reference, amount, metadata, customer } = event.data;

      const bookingId = metadata?.bookingId as string | undefined;
      const businessId = metadata?.businessId as string | undefined;

      if (bookingId && businessId) {
        await db.$transaction(async (tx) => {
          // Update booking status to CONFIRMED
          await tx.booking.update({
            where: { id: bookingId },
            data: { status: "CONFIRMED" },
          });

          // Create a payment record
          await tx.payment.create({
            data: {
              businessId,
              amount: amount / 100, // Convert from smallest unit (kobo/cents) to main unit
              method: "PAYSTACK",
              reference,
              clientName: [customer.first_name, customer.last_name]
                .filter(Boolean)
                .join(" ") || undefined,
              clientEmail: customer.email,
            },
          });
        });
      }
    }

    // Always return 200 to acknowledge receipt
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error: any) {
    console.error("Paystack webhook error:", error.message || error);
    // Still return 200 to prevent Paystack from retrying
    return NextResponse.json({ status: "ok" }, { status: 200 });
  }
}

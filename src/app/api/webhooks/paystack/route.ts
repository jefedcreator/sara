import { emailService } from "@/backend/services/email";
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
 *
 *              On `charge.success`:
 *              1. Checks idempotency — skips if a Payment with the same reference already exists.
 *              2. Validates the booking exists and is still PENDING.
 *              3. Atomically confirms the booking and creates a Payment record.
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

    switch (event.event) {
      case "charge.success":
        await handleChargeSuccess(event);
        break;

      default:
        console.log(`[Paystack Webhook] Unhandled event type: ${event.event}`);
    }

    // Always return 200 to acknowledge receipt
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error: any) {
    console.error("[Paystack Webhook] Error:", error.message || error);
    // Still return 200 to prevent Paystack from retrying endlessly
    return NextResponse.json({ status: "ok" }, { status: 200 });
  }
}

/**
 * Handles a successful charge event from Paystack.
 *
 * Flow:
 * 1. Extract bookingId and businessId from transaction metadata.
 * 2. Idempotency check — skip if a payment with this reference already exists.
 * 3. Validate the booking exists and is in PENDING status.
 * 4. Atomically: confirm the booking + create a Payment record.
 */
async function handleChargeSuccess(event: PaystackWebhookEvent) {
  const { reference, amount, metadata, customer, channel } = event.data;

  const bookingId = metadata?.bookingId as string | undefined;
  const businessId = metadata?.businessId as string | undefined;

  if (!bookingId || !businessId) {
    console.warn(
      `[Paystack Webhook] charge.success missing bookingId or businessId in metadata. Reference: ${reference}`,
    );
    return;
  }

  // Idempotency: skip if this reference was already processed
  const existingPayment = await db.payment.findUnique({
    where: { reference },
  });

  if (existingPayment) {
    console.log(
      `[Paystack Webhook] Duplicate event — payment with reference ${reference} already exists. Skipping.`,
    );
    return;
  }

  // Validate the booking
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      businessId: true,
      startTime: true,
      clientName: true,
      clientEmail: true,
      clientPhone: true,
      service: { select: { name: true } },
      business: { select: { name: true } },
    },
  });

  if (!booking) {
    console.error(
      `[Paystack Webhook] Booking ${bookingId} not found. Reference: ${reference}`,
    );
    return;
  }

  if (booking.businessId !== businessId) {
    console.error(
      `[Paystack Webhook] Business mismatch — booking ${bookingId} belongs to ${booking.businessId}, but metadata says ${businessId}. Reference: ${reference}`,
    );
    return;
  }

  if (booking.status !== "PENDING") {
    console.warn(
      `[Paystack Webhook] Booking ${bookingId} is ${booking.status}, not PENDING. Skipping status update. Reference: ${reference}`,
    );
    return;
  }

  // Atomically confirm booking + create payment
  await db.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    });

    await tx.payment.create({
      data: {
        businessId,
        amount: amount / 100, // Convert from smallest unit (kobo/cents) to main unit
        method: "PAYSTACK",
        reference,
        clientName:
          booking.clientName ||
          [customer.first_name, customer.last_name]
            .filter(Boolean)
            .join(" ") ||
          undefined,
        clientEmail: booking.clientEmail || customer.email,
        clientPhone: booking.clientPhone,
      },
    });
  });

  console.log(
    `[Paystack Webhook] Booking ${bookingId} confirmed. Payment ref: ${reference}, amount: ${amount / 100}, channel: ${channel}`,
  );

  // Best-effort: a failed confirmation email must never fail the webhook.
  const clientEmail = booking.clientEmail ?? customer.email;
  if (clientEmail) {
    try {
      await emailService.sendBookingConfirmationEmail({
        to: clientEmail,
        businessName: booking.business.name,
        serviceName: booking.service.name,
        startTime: booking.startTime,
      });
    } catch (err) {
      console.warn("[Paystack Webhook] Confirmation email failed:", err);
    }
  }
}

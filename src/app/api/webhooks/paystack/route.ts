import {
  blockingBookingsWhere,
  isSerializationFailure,
} from "@/backend/services/booking/conflicts";
import { emailService } from "@/backend/services/email";
import { googleCalendarService } from "@/backend/services/googleCalendar";
import { formatMoney } from "@/backend/services/messaging/engine/amount";
import { ownerNotifier } from "@/backend/services/messaging/notify";
import {
  paystackService,
  type PaystackWebhookEvent,
} from "@/backend/services/paystack";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";
import { shareUrl } from "@/server/share";
import { bookingWhen } from "@/utils/format";
import { Prisma } from "@prisma/client";
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
    if (isSerializationFailure(error)) {
      return NextResponse.json(
        { message: "Serialization conflict, please retry" },
        { status: 500 }
      );
    }
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
      serviceId: true,
      units: true,
      amount: true,
      holdExpiresAt: true,
      startTime: true,
      endTime: true,
      notes: true,
      clientName: true,
      clientEmail: true,
      clientPhone: true,
      service: {
        select: {
          id: true,
          name: true,
          slug: true,
          duration: true,
          price: true,
          bookingMode: true,
        },
      },
      business: {
        select: {
          id: true,
          name: true,
          email: true,
          currency: true,
          owner: { select: { email: true } },
          googleCalendarId: true,
          googleCalendarAccessToken: true,
          googleCalendarRefreshToken: true,
          googleCalendarTokenExpiry: true,
        },
      },
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

  const span = {
    bookingMode: booking.service.bookingMode,
    endTime: booking.endTime,
    units: booking.units,
  };
  const whenText = bookingWhen({
    bookingMode: booking.service.bookingMode,
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
    units: booking.units,
  });
  const paymentData = {
    businessId,
    amount: amount / 100, // Convert from smallest unit (kobo/cents) to main unit
    method: "PAYSTACK" as const,
    reference,
    clientName:
      booking.clientName ||
      [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
      undefined,
    clientEmail: booking.clientEmail || customer.email,
    clientPhone: booking.clientPhone,
  };

  // Decide and record in one serializable transaction, so a new booking
  // cannot slip into the time between the check and the confirmation. If the
  // hold ran out before Paystack told us, confirm only when nobody has taken
  // the time since; otherwise cancel, keep the payment on record, and tell
  // the owner to refund it.
  const decide = () =>
    db.$transaction(
      async (tx) => {
        const now = new Date();
        if (booking.holdExpiresAt && booking.holdExpiresAt <= now) {
          const taken = await tx.booking.findFirst({
            where: blockingBookingsWhere(
              {
                id: booking.serviceId,
                businessId: booking.businessId,
                bookingMode: booking.service.bookingMode,
              },
              { start: booking.startTime, end: booking.endTime },
              { now, excludeId: booking.id },
            ),
            select: { id: true },
          });
          if (taken) {
            await tx.booking.update({
              where: { id: bookingId },
              data: { status: "CANCELLED" },
            });
            await tx.payment.create({ data: paymentData });
            return "cancelled" as const;
          }
        }
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: "CONFIRMED" },
        });
        await tx.payment.create({ data: paymentData });
        return "confirmed" as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

  let outcome: "cancelled" | "confirmed";
  try {
    outcome = await decide();
  } catch (error) {
    if (!isSerializationFailure(error)) throw error;
    outcome = await decide();
  }

  if (outcome === "cancelled") {
      console.warn(
        `[Paystack Webhook] Late payment for resold time; booking ${bookingId} cancelled. Ref: ${reference}`,
      );
      try {
        await ownerNotifier.notify(
          businessId,
          `⚠️ ${booking.clientName ?? "A customer"} paid ${formatMoney(
            amount / 100,
            booking.business.currency,
          )} for ${booking.service.name} (${whenText}), but that time was already booked. The booking is cancelled. Refund it from your Paystack dashboard.`,
        );
      } catch (err) {
        console.warn("[Paystack Webhook] Owner notification failed:", err);
      }
      const lateEmail = booking.clientEmail ?? customer.email;
      if (lateEmail) {
        try {
          await emailService.sendBookingCancellationEmail({
            to: lateEmail,
            business: booking.business,
            serviceName: booking.service.name,
            serviceSlug: booking.service.slug,
            startTime: booking.startTime,
            span,
          });
        } catch (err) {
          console.warn("[Paystack Webhook] Cancellation email failed:", err);
        }
      }
      return;
  }

  console.log(
    `[Paystack Webhook] Booking ${bookingId} confirmed. Payment ref: ${reference}, amount: ${amount / 100}, channel: ${channel}`,
  );

  // Best-effort: auto-create a receipt for the paid booking.
  let receiptUrl: string | null = null;
  try {
    const payment = await db.payment.findUnique({
      where: { reference },
      select: { id: true },
    });
    const receipt = await receiptService.create({
      businessId,
      paymentId: payment?.id ?? null,
      name: booking.clientName ?? null,
      email: booking.clientEmail ?? null,
      phone: booking.clientPhone ?? null,
      currency: booking.business.currency,
      subtotal: amount / 100,
      taxAmount: 0,
      discount: 0,
      total: amount / 100,
      amountPaid: amount / 100,
      paymentMethod: "PAYSTACK",
      services: [
        {
          serviceId: booking.serviceId,
          description: booking.service.name,
          quantity: booking.units,
          unitPrice: amount / 100 / booking.units,
          total: amount / 100,
        },
      ],
    });
    receiptUrl = shareUrl("receipt", receipt.slug);
  } catch (err) {
    console.warn("[Paystack Webhook] Receipt creation failed:", err);
  }

  // Best-effort: notify the owner on their linked chat channel(s).
  try {
    const paidLine = `💰 ${booking.clientName ?? "A customer"} paid ${formatMoney(
      amount / 100,
      booking.business.currency,
    )} for ${booking.service.name} (${whenText}).`;
    const text = receiptUrl ? `${paidLine}\nReceipt: ${receiptUrl}` : paidLine;
    await ownerNotifier.notify(businessId, text);
  } catch (err) {
    console.warn("[Paystack Webhook] Owner notification failed:", err);
  }

  // Best-effort: a failed email must never fail the webhook. The customer's
  // confirmation carries the receipt link, so the receipt isn't emailed on
  // its own; the owner gets the chat notice above and this email.
  const clientEmail = booking.clientEmail ?? customer.email;
  if (clientEmail) {
    try {
      await emailService.sendBookingConfirmationEmail({
        to: clientEmail,
        business: booking.business,
        serviceName: booking.service.name,
        startTime: booking.startTime,
        duration: booking.service.duration,
        amount: amount / 100,
        currency: booking.business.currency,
        receiptUrl,
        span,
      });
    } catch (err) {
      console.warn("[Paystack Webhook] Confirmation email failed:", err);
    }
  }
  const ownerEmail = booking.business.owner.email;
  if (ownerEmail) {
    try {
      await emailService.sendNewBookingEmail({
        to: ownerEmail,
        clientName: booking.clientName ?? "A customer",
        clientEmail,
        clientPhone: booking.clientPhone,
        serviceName: booking.service.name,
        startTime: booking.startTime,
        amount: amount / 100,
        currency: booking.business.currency,
        span,
      });
    } catch (err) {
      console.warn("[Paystack Webhook] Owner booking email failed:", err);
    }
  }

  // Best-effort: a failed Calendar sync must never fail the webhook.
  try {
    const result = await googleCalendarService.createEvent(
      booking.business,
      booking,
      booking.service,
    );
    if (result) {
      await db.booking.update({
        where: { id: bookingId },
        data: { googleEventId: result.googleEventId },
      });
    }
  } catch (err) {
    console.warn("[Paystack Webhook] Calendar sync failed:", err);
  }
}

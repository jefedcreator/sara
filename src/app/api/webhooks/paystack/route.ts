import {
  blockingBookingsWhere,
  isSerializationFailure,
} from "@/backend/services/booking/conflicts";
import { emailService } from "@/backend/services/email";
import { invoicePayments } from "@/backend/services/invoice/payment";
import { googleCalendarService } from "@/backend/services/googleCalendar";
import { formatMoney } from "@/backend/services/messaging/engine/amount";
import { ownerNotifier } from "@/backend/services/messaging/notify";
import { processOrderPayment } from "@/backend/services/order/payment";
import {
  paystackService,
  type PaystackWebhookEvent,
  type SuccessfulPaymentData,
} from "@/backend/services/paystack";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";
import { publicLink } from "@/server/share";
import { bookingWhen } from "@/utils/format";
import { publicPath } from "@/utils/public-links";
import { appBaseUrl } from "@/utils/url";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * @description Paystack webhook endpoint for payment event notifications.
 *              Validates the webhook signature, then processes the event.
 *
 *              On `charge.success`:
 *              1. Orders: hands the charge to `processOrderPayment` when the
 *                 metadata carries an `orderId`.
 *              2. Invoices: hands it to `invoicePayments.process` when the
 *                 metadata carries an `invoiceId`.
 *              3. Bookings: checks idempotency, validates the booking, then
 *                 atomically confirms it and creates a Payment record.
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
 * @description Handles Paystack post-payment redirect (Callback URL).
 *              Paystack redirects the user's browser here after payment.
 *              We perform a server-side redirect to the frontend to cleanly strip query parameters.
 *              A payment already linked to a booking, an order or an invoice
 *              goes straight to that page; otherwise we verify the transaction
 *              with Paystack before following the `?b=<bookingSlug>`,
 *              `?o=<orderSlug>` or `?i=<invoicePublicId>` hint.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const reference =
    url.searchParams.get("reference") || url.searchParams.get("trxref");
  const bookingSlug = url.searchParams.get("b");
  const orderSlug = url.searchParams.get("o");
  const invoicePublicId = url.searchParams.get("i");
  const baseUrl = appBaseUrl();

  if (reference) {
    const existingPayment = await db.payment.findUnique({
      where: { reference },
      include: {
        booking: {
          select: { id: true, publicId: true, slug: true },
        },
        order: {
          select: { publicId: true },
        },
        invoice: {
          select: { publicId: true },
        },
      },
    });

    if (existingPayment?.booking) {
      return NextResponse.redirect(
        new URL(publicPath("booking", existingPayment.booking.publicId), baseUrl),
      );
    }

    if (existingPayment?.order) {
      return NextResponse.redirect(
        new URL(publicPath("order", existingPayment.order.publicId), baseUrl),
      );
    }

    if (existingPayment?.invoice) {
      return NextResponse.redirect(
        new URL(publicPath("invoice", existingPayment.invoice.publicId), baseUrl),
      );
    }

    try {
      const verification = await paystackService.verifyTransaction(reference);
      if (verification && verification.status === "success") {
        const result = await processSuccessfulPayment({
          reference: verification.reference,
          amount: verification.amount,
          metadata: verification.metadata,
          customer: verification.customer,
          channel: verification.channel,
        });

        if (result && "booking" in result && result.booking) {
          return NextResponse.redirect(
            new URL(publicPath("booking", result.booking.publicId), baseUrl),
          );
        }

        if (result && "order" in result && result.order) {
          return NextResponse.redirect(
            new URL(publicPath("order", result.order.publicId), baseUrl),
          );
        }

        if (result && "invoice" in result && result.invoice) {
          return NextResponse.redirect(
            new URL(publicPath("invoice", result.invoice.publicId), baseUrl),
          );
        }
      }
    } catch (error: any) {
      console.error(
        "[Paystack Callback] Verification failed:",
        error?.message || error,
      );
    }
  }

  if (orderSlug) {
    const order = await db.order.findUnique({
      where: { slug: orderSlug },
      select: { publicId: true },
    });
    if (order) {
      return NextResponse.redirect(
        new URL(publicPath("order", order.publicId), baseUrl),
      );
    }
  }

  if (invoicePublicId) {
    const invoice = await db.invoice.findUnique({
      where: { publicId: invoicePublicId },
      select: { publicId: true },
    });
    if (invoice) {
      return NextResponse.redirect(
        new URL(publicPath("invoice", invoice.publicId), baseUrl),
      );
    }
  }

  if (bookingSlug) {
    const booking = await db.booking.findUnique({
      where: { slug: bookingSlug },
      select: { publicId: true },
    });
    if (booking) {
      return NextResponse.redirect(
        new URL(publicPath("booking", booking.publicId), baseUrl),
      );
    }
  }

  return NextResponse.redirect(new URL("/", baseUrl));
}

/**
 * Handles a successful charge event from Paystack.
 *
 * Flow:
 * 1. If the metadata carries an `orderId`, hand the charge to the order
 *    processor and stop there. An `invoiceId` goes to the invoice processor.
 * 2. Otherwise extract bookingId and businessId from transaction metadata.
 * 3. Idempotency check — skip if a payment with this reference already exists.
 * 4. Validate the booking exists and is in PENDING status.
 * 5. Atomically: confirm the booking + create a Payment record.
 */
async function processSuccessfulPayment(data: SuccessfulPaymentData) {
  const { reference, amount, metadata, channel } = data;
  const customer = data.customer ?? { email: "" };

  // Orders have their own processor; a charge for one never carries a booking.
  if (typeof metadata?.orderId === "string") {
    const result = await processOrderPayment(data);
    return result ? { order: result.order } : null;
  }

  // Invoices likewise: a part payment is a charge for an invoice, not a booking.
  if (typeof metadata?.invoiceId === "string") {
    const result = await invoicePayments.process(data);
    return result ? { invoice: result.invoice } : null;
  }

  let bookingId = metadata?.bookingId as string | undefined;
  let businessId = metadata?.businessId as string | undefined;

  if (!bookingId && typeof metadata?.bookingSlug === "string") {
    const b = await db.booking.findUnique({
      where: { slug: metadata.bookingSlug },
      select: { id: true, businessId: true },
    });
    if (b) {
      bookingId = b.id;
      businessId = businessId || b.businessId;
    }
  }

  if (!bookingId || !businessId) {
    console.warn(
      `[Paystack Webhook] charge.success missing bookingId or businessId in metadata. Reference: ${reference}`,
    );
    return null;
  }

  // Idempotency: skip if this reference was already processed
  const existingPayment = await db.payment.findUnique({
    where: { reference },
    include: {
      booking: {
        select: {
          id: true,
          publicId: true,
          status: true,
          businessId: true,
          serviceId: true,
          customerId: true,
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
      },
    },
  });

  if (existingPayment) {
    console.log(
      `[Paystack Webhook] Duplicate event — payment with reference ${reference} already exists. Skipping.`,
    );
    return {
      booking: existingPayment.booking ?? undefined,
      outcome: "confirmed" as const,
    };
  }

  // Validate the booking
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      publicId: true,
      status: true,
      businessId: true,
      serviceId: true,
      customerId: true,
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
    bookingId: booking.id,
    amount: amount / 100, // Convert from smallest unit (kobo/cents) to main unit
    method: "PAYSTACK" as const,
    reference,
    customerId: booking.customerId ?? null,
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
      return { booking, outcome: "cancelled" as const };
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
      customerId: booking.customerId ?? null,
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
      lines: [
        {
          serviceId: booking.serviceId,
          description: booking.service.name,
          quantity: booking.units,
          unitPrice: amount / 100 / booking.units,
          total: amount / 100,
        },
      ],
    });
    receiptUrl = publicLink("receipt", receipt.publicId);
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
        bookingUrl: publicLink("booking", booking.publicId),
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

  return { booking, outcome: "confirmed" as const };
}

const handleChargeSuccess = (event: PaystackWebhookEvent) =>
  processSuccessfulPayment(event.data);


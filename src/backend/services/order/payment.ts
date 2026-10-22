import { isSerializationFailure } from "@/backend/services/booking/conflicts";
import { emailService } from "@/backend/services/email";
import { ownerNotifier } from "@/backend/services/messaging/notify";
import type { SuccessfulPaymentData } from "@/backend/services/paystack";
import { takeStock } from "@/backend/services/product/stock";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";
import { publicLink } from "@/server/share";
import { Prisma } from "@prisma/client";

import { orderAlertText } from "./alerts";
import { nextOrderNumber } from "./index";

const isUniqueConstraint = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "P2002";

/** The only relation a duplicate reference needs to send the customer back. */
type ExistingPayment = {
  order: { publicId: string } | null;
};

/** The next order number and the stock shortfall from inside the transaction. */
type RecordedPayment = {
  payment: { id: string };
  orderNumber: string;
  oversold: boolean;
};

/**
 * Confirm a paid online order.
 *
 * The reference is the idempotency key: a second webhook or callback for the
 * same charge returns the linked order without writing anything. Otherwise one
 * serializable transaction marks the order NEW, numbers it, takes the stock
 * and records the Payment, so a payment can never take stock twice. A short
 * stock count is not a reason to drop the payment: it takes what is left and
 * sets `oversold`.
 *
 * The receipt, owner alert and customer email happen afterwards and are best
 * effort: a failure there must not lose the payment.
 */
export async function processOrderPayment(
  data: SuccessfulPaymentData,
): Promise<{ order: { publicId: string } } | null> {
  const { reference, amount, metadata } = data;

  const existing: ExistingPayment | null = await db.payment.findUnique({
    where: { reference },
    select: { order: { select: { publicId: true } } },
  });

  if (existing) {
    console.log(
      `[Paystack Webhook] Duplicate event — payment with reference ${reference} already exists. Skipping.`,
    );
    return existing.order ? { order: existing.order } : null;
  }

  let orderId =
    typeof metadata?.orderId === "string" ? metadata.orderId : undefined;

  if (!orderId && typeof metadata?.orderSlug === "string") {
    const bySlug = await db.order.findUnique({
      where: { slug: metadata.orderSlug },
      select: { id: true },
    });
    orderId = bySlug?.id;
  }

  if (!orderId) {
    console.warn(
      `[Paystack Webhook] charge.success missing an order in metadata. Reference: ${reference}`,
    );
    return null;
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      lines: true,
      business: {
        select: {
          id: true,
          name: true,
          email: true,
          address: true,
          currency: true,
        },
      },
    },
  });

  if (!order) {
    console.warn(
      `[Paystack Webhook] Order ${orderId} not found. Reference: ${reference}`,
    );
    return null;
  }

  const businessId = metadata?.businessId;
  if (typeof businessId !== "string" || businessId !== order.businessId) {
    console.warn(
      `[Paystack Webhook] Business mismatch — order ${orderId} belongs to ${order.businessId}, but metadata says ${String(businessId)}. Reference: ${reference}`,
    );
    return null;
  }

  if (amount !== Math.round(Number(order.total) * 100)) {
    console.warn(
      `[Paystack Webhook] Amount mismatch for order ${orderId}: paid ${amount}, expected ${Math.round(Number(order.total) * 100)}. Reference: ${reference}`,
    );
    return null;
  }

  const stockLines = order.lines
    .filter((line) => Boolean(line.productOptionId))
    .map((line) => ({
      productOptionId: line.productOptionId as string,
      quantity: line.quantity,
    }));

  const record = () =>
    db.$transaction(
      async (tx): Promise<RecordedPayment> => {
        const stock = await takeStock(tx, stockLines);
        const orderNumber = await nextOrderNumber(tx, order.businessId);
        const paidAt = new Date();

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "NEW",
            paidAt,
            orderNumber,
            oversold: stock.short,
          },
        });

        const payment = await tx.payment.create({
          data: {
            businessId: order.businessId,
            orderId: order.id,
            customerId: order.customerId,
            amount: amount / 100,
            method: "PAYSTACK",
            reference,
            clientName: order.clientName,
            clientEmail: order.clientEmail,
            clientPhone: order.clientPhone,
          },
        });

        return { payment, orderNumber, oversold: stock.short };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

  let outcome: Awaited<ReturnType<typeof record>>;
  try {
    outcome = await record();
  } catch (error) {
    // A webhook and the callback verification can race: both pass the check
    // above, one wins the unique reference, the other lands here.
    if (isUniqueConstraint(error)) {
      const winner: ExistingPayment | null = await db.payment.findUnique({
        where: { reference },
        select: { order: { select: { publicId: true } } },
      });
      if (winner) return winner.order ? { order: winner.order } : null;
    }

    const retryable =
      isSerializationFailure(error) || isUniqueConstraint(error);
    if (!retryable) throw error;

    outcome = await record();
  }

  const { payment, orderNumber, oversold } = outcome;

  // Best effort: the automatic receipt, with the delivery fee as its own line.
  let receiptUrl: string | null = null;
  try {
    const deliveryFee = Number(order.deliveryFee);
    const receipt = await receiptService.create({
      businessId: order.businessId,
      customerId: order.customerId,
      paymentId: payment.id,
      name: order.clientName,
      email: order.clientEmail,
      phone: order.clientPhone,
      currency: order.currency,
      subtotal: Number(order.subtotal),
      taxAmount: 0,
      discount: 0,
      total: Number(order.total),
      amountPaid: amount / 100,
      paymentMethod: "PAYSTACK",
      lines: [
        ...order.lines.map((line) => ({
          productOptionId: line.productOptionId,
          name: line.name,
          quantity: line.quantity,
          unitPrice: Number(line.unitPrice),
          total: Number(line.total),
        })),
        ...(deliveryFee > 0
          ? [
              {
                name: "Delivery",
                quantity: 1,
                unitPrice: deliveryFee,
                total: deliveryFee,
              },
            ]
          : []),
      ],
    });

    receiptUrl = publicLink("receipt", receipt.publicId);
    await db.order.update({
      where: { id: order.id },
      data: { receiptId: receipt.id },
    });
  } catch (error) {
    console.warn("[Paystack Webhook] Receipt creation failed:", error);
  }

  // Best effort: alert the owner on their linked chat channel(s).
  try {
    await ownerNotifier.notify(
      order.businessId,
      orderAlertText({
        orderNumber,
        clientName: order.clientName,
        lines: order.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
        })),
        total: Number(order.total),
        currency: order.currency,
        fulfilment: order.fulfilment,
        deliveryAddress: order.deliveryAddress,
        oversold,
      }),
    );
  } catch (error) {
    console.warn("[Paystack Webhook] Owner notification failed:", error);
  }

  // Best effort: email the customer only when they gave an address at checkout.
  if (order.clientEmail) {
    try {
      await emailService.sendOrderEmail({
        kind: "confirmed",
        to: order.clientEmail,
        business: order.business,
        orderNumber,
        lines: order.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          total: Number(line.total),
        })),
        total: Number(order.total),
        currency: order.currency,
        fulfilment: order.fulfilment,
        deliveryAddress: order.deliveryAddress,
        pickupAddress: order.business.address ?? null,
        receiptUrl,
        orderUrl: publicLink("order", order.publicId),
      });
    } catch (error) {
      console.warn("[Paystack Webhook] Confirmation email failed:", error);
    }
  }

  return { order: { publicId: order.publicId } };
}

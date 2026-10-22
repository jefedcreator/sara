import { cache } from "react";

import { db } from "@/server/db";
import { orderStatusLabel } from "@/utils/labels";
import {
  orderStatusTone,
  type PublicOrder,
} from "@/utils/order-page";
import { publicPath } from "@/utils/public-links";

/** Trimmed, comma-joined address parts; blank parts drop. */
function joinParts(parts: (string | null | undefined)[]) {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * The order behind a customer's link, or null for an unknown id. A paused
 * product or a removed option changes nothing here: every line carries the
 * name it was placed under. Never reads the customer's phone or email.
 */
export const getPublicOrder = cache(
  async (publicId: string): Promise<PublicOrder | null> => {
    const order = await db.order.findUnique({
      where: { publicId },
      select: {
        publicId: true,
        orderNumber: true,
        status: true,
        fulfilment: true,
        deliveryAddress: true,
        subtotal: true,
        deliveryFee: true,
        total: true,
        currency: true,
        paidAt: true,
        createdAt: true,
        business: {
          select: { name: true, address: true, city: true, state: true },
        },
        receipt: { select: { publicId: true } },
        lines: {
          orderBy: { id: "asc" },
          select: { name: true, quantity: true, unitPrice: true, total: true },
        },
      },
    });
    if (!order) return null;

    return {
      publicId: order.publicId,
      orderNumber: order.orderNumber,
      status: order.status,
      fulfilment: order.fulfilment,
      statusLabel: orderStatusLabel(order.status, order.fulfilment),
      statusTone: orderStatusTone(order.status),
      businessName: order.business.name,
      currency: order.currency,
      lines: order.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitPrice: Number(line.unitPrice),
        total: Number(line.total),
      })),
      subtotal: Number(order.subtotal),
      deliveryFee: Number(order.deliveryFee),
      total: Number(order.total),
      deliveryAddress: order.deliveryAddress,
      pickupAddress:
        joinParts([
          order.business.address,
          order.business.city,
          order.business.state,
        ]) || null,
      paidAt: order.paidAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      receiptPath: order.receipt
        ? publicPath("receipt", order.receipt.publicId)
        : null,
    };
  },
);

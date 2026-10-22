import type { Fulfilment, OrderStatus } from "@prisma/client";
import type { Metadata } from "next";

import { formatMoney } from "@/utils/format";
import { linkNotFoundMetadata, pageMetadata } from "@/utils/metadata";

/*
 * A customer's order as their link (/orders/<publicId>) shows it. Pure, so
 * the page, its metadata and its status pill share one reading.
 */

export type OrderTone = "accent" | "muted" | "danger";

export type PublicOrderLine = {
  /** The name snapshot taken when the order was placed, not the option's today. */
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type PublicOrder = {
  publicId: string;
  orderNumber: string | null;
  status: OrderStatus;
  fulfilment: Fulfilment;
  statusLabel: string;
  statusTone: OrderTone;
  businessName: string;
  currency: string;
  lines: PublicOrderLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryAddress: string | null;
  pickupAddress: string | null;
  paidAt: string | null;
  createdAt: string;
  /** "/receipts/<publicId>" once the automatic receipt exists. */
  receiptPath: string | null;
};

/**
 * "Order ORD-1022", or "Your order" until the payment is confirmed. An unpaid
 * checkout has no number yet, so the title names what the customer is doing.
 */
export function orderHeadline(
  order: Pick<PublicOrder, "status" | "orderNumber">,
) {
  if (order.status === "AWAITING_PAYMENT" || !order.orderNumber) {
    return "Your order";
  }
  return `Order ${order.orderNumber}`;
}

/** Green while the order is being fulfilled, quiet once it is done or unpaid. */
export function orderStatusTone(status: OrderStatus): OrderTone {
  switch (status) {
    case "NEW":
    case "READY":
      return "accent";
    case "AWAITING_PAYMENT":
    case "COMPLETED":
    case "CANCELLED":
      return "muted";
  }
}

/** The link preview. A customer's order is never indexed. */
export function orderMetadata(
  order: PublicOrder | null,
  path: string,
): Metadata {
  if (!order) return linkNotFoundMetadata(path);

  let description: string;
  if (order.status === "AWAITING_PAYMENT") {
    description = `Your order from ${order.businessName} is waiting for payment.`;
  } else if (order.status === "CANCELLED") {
    description = `This order from ${order.businessName} was cancelled.`;
  } else {
    description = `${formatMoney(order.total, order.currency)} order from ${order.businessName}. ${order.statusLabel}.`;
  }

  return pageMetadata({
    title: `${orderHeadline(order)} · ${order.businessName}`,
    description,
    path,
    index: false,
  });
}

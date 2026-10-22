import { formatMoney } from "@/backend/services/messaging/engine/amount";

/** The facts the owner's new-order alert needs. */
export type OrderAlertOrder = {
  orderNumber: string;
  clientName: string;
  lines: { name: string; quantity: number }[];
  total: number;
  currency: string;
  fulfilment: "DELIVERY" | "PICKUP";
  deliveryAddress: string | null;
  oversold: boolean;
};

/**
 * The owner's chat alert for a paid order:
 * `🛍️ New order ORD-1022 · Tolu Adeyemi · 2 × Frontal wig — 20" · NGN 93,000 · Delivery to 12 Admiralty Way`.
 * A pickup order ends with "Pickup" instead of an address; an oversold order
 * gets a second line telling the owner to restock or refund.
 */
export function orderAlertText(order: OrderAlertOrder): string {
  const items = order.lines
    .map((line) => `${line.quantity} × ${line.name}`)
    .join(", ");

  const where =
    order.fulfilment === "PICKUP"
      ? "Pickup"
      : order.deliveryAddress
        ? `Delivery to ${order.deliveryAddress}`
        : "Delivery";

  const base = `🛍️ New order ${order.orderNumber} · ${order.clientName} · ${items} · ${formatMoney(order.total, order.currency)} · ${where}`;

  return order.oversold
    ? `${base}\n⚠️ Paid after it sold out. Restock or refund the customer.`
    : base;
}

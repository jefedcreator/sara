import { describe, expect, it } from "vitest";

import { orderAlertText, type OrderAlertOrder } from "./alerts";

const ORDER: OrderAlertOrder = {
  orderNumber: "ORD-1022",
  clientName: "Tolu Adeyemi",
  lines: [{ name: 'Frontal wig — 20"', quantity: 2 }],
  total: 93000,
  currency: "NGN",
  fulfilment: "DELIVERY",
  deliveryAddress: "12 Admiralty Way",
  oversold: false,
};

describe("orderAlertText", () => {
  it("names the order, customer, items, total and delivery address", () => {
    expect(orderAlertText(ORDER)).toBe(
      '🛍️ New order ORD-1022 · Tolu Adeyemi · 2 × Frontal wig — 20" · NGN 93,000 · Delivery to 12 Admiralty Way',
    );
  });

  it("ends a pickup alert with 'Pickup'", () => {
    expect(
      orderAlertText({
        ...ORDER,
        fulfilment: "PICKUP",
        deliveryAddress: "12 Admiralty Way",
      }),
    ).toBe(
      '🛍️ New order ORD-1022 · Tolu Adeyemi · 2 × Frontal wig — 20" · NGN 93,000 · Pickup',
    );
  });

  it("adds a second line to an oversold alert", () => {
    expect(orderAlertText({ ...ORDER, oversold: true })).toBe(
      '🛍️ New order ORD-1022 · Tolu Adeyemi · 2 × Frontal wig — 20" · NGN 93,000 · Delivery to 12 Admiralty Way\n⚠️ Paid after it sold out. Restock or refund the customer.',
    );
  });
});

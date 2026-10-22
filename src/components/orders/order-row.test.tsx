import { renderToStaticMarkup } from "react-dom/server";
import type { OrderDto } from "types";
import { describe, expect, it } from "vitest";

import { OrderRow } from "./order-row";

const BASE_ORDER = {
  id: "ord_1",
  slug: "ord-1022",
  publicId: "Xk39fjQ2aB7mN0pR",
  businessId: "biz_1",
  customerId: "cus_1",
  orderNumber: "ORD-1022",
  status: "READY",
  source: "PRODUCT_LINK",
  fulfilment: "DELIVERY",
  deliveryAddress: "12 Allen Avenue, Ikeja",
  deliveryFee: "3000",
  subtotal: "90000",
  total: "93000",
  currency: "NGN",
  holdExpiresAt: null,
  oversold: false,
  invoiceId: null,
  receiptId: null,
  clientName: "Tolu Adeyemi",
  clientPhone: "+2348035550142",
  clientEmail: "tolu@example.com",
  notes: null,
  paidAt: "2026-10-20T10:00:00.000Z",
  readyAt: null,
  completedAt: null,
  cancelledAt: null,
  createdAt: "2026-10-20T09:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  lines: [
    {
      id: "line_1",
      orderId: "ord_1",
      productOptionId: "opt_1",
      name: 'Frontal wig — 20"',
      quantity: 2,
      unitPrice: "45000",
      total: "90000",
    },
  ],
  customer: { id: "cus_1", name: "Tolu Adeyemi", phone: "+2348035550142", email: "tolu@example.com" },
  invoice: null,
  receipt: null,
} as unknown as OrderDto;

function render(overrides: Partial<OrderDto> = {}) {
  return renderToStaticMarkup(
    <OrderRow
      order={{ ...BASE_ORDER, ...overrides }}
      link="https://sara.test/orders/Xk39fjQ2aB7mN0pR"
      busy={false}
      onAdvance={() => undefined}
      onCancel={() => undefined}
      onSwitchToDelivery={() => undefined}
    />,
  );
}

describe("OrderRow component", () => {
  it("shows number, customer, items, total and status label", () => {
    const html = render();

    expect(html).toContain("ORD-1022");
    expect(html).toContain("Tolu Adeyemi");
    // React escapes the inch mark in text.
    expect(html).toContain("2 × Frontal wig — 20&quot;");
    expect(html).toContain("NGN 93,000");
    expect(html).toContain("Out for delivery");
  });

  it("links the customer's phone", () => {
    expect(render()).toContain('href="tel:+2348035550142"');
  });

  it.each([
    ["NEW", "PICKUP", "Mark ready"],
    ["READY", "PICKUP", "Mark collected"],
    ["READY", "DELIVERY", "Mark delivered"],
  ] as const)("offers the next step for %s %s", (status, fulfilment, label) => {
    const html = render({ status, fulfilment });

    expect(html).toContain(`>${label}</button>`);
  });

  it.each(["COMPLETED", "CANCELLED"] as const)(
    "offers no next step on a %s order",
    (status) => {
      const html = render({ status });

      expect(html).not.toContain("Mark ");
      expect(html).not.toContain(">Cancel</button>");
    },
  );

  it("flags an oversold order", () => {
    const html = render({ oversold: true });

    expect(html).toContain("Oversold");
    expect(html).toContain("Paid after it sold out. Restock or refund.");
  });

  it("shows the invoice an order came from and offers delivery on a pickup", () => {
    const html = render({
      status: "NEW",
      fulfilment: "PICKUP",
      deliveryAddress: null,
      invoice: { id: "inv_1", publicId: "abc", invoiceNumber: "INV-1042" },
    });

    expect(html).toContain("From INV-1042");
    expect(html).toContain("Change to delivery");
  });
});

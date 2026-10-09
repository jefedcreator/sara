import { renderToStaticMarkup } from "react-dom/server";
import type { ReceiptDto } from "types";
import { describe, expect, it, vi } from "vitest";

import { ReceiptRow } from "./receipt-row";

const BASE_RECEIPT: ReceiptDto = {
  id: "rcp_1",
  slug: "rcp-1",
  publicId: "pub_rcp_1",
  businessId: "biz_1",
  paymentId: null,
  receiptNumber: "RCP-1001",
  name: "Bisi Akande",
  email: "bisi@example.com",
  phone: "+2348098765432",
  currency: "NGN",
  subtotal: "15000",
  taxAmount: "0",
  discount: "0",
  total: "15000",
  amountPaid: "15000",
  paymentMethod: "CASH",
  notes: "Walk-in payment",
  url: "https://cdn.test/rcp.pdf",
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
  business: { id: "biz_1", name: "Sara Salon" } as any,
  payment: null,
  services: [],
};

describe("ReceiptRow component", () => {
  it("renders Edit button for standalone CASH receipt when onEdit is passed", () => {
    const html = renderToStaticMarkup(
      <ReceiptRow
        receipt={{ ...BASE_RECEIPT, paymentMethod: "CASH", payment: null }}
        link="https://app.sara.ng/r/pub_rcp_1"
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain(">Edit</button>");
  });

  it("renders Edit button for standalone BANK_TRANSFER receipt when onEdit is passed", () => {
    const html = renderToStaticMarkup(
      <ReceiptRow
        receipt={{ ...BASE_RECEIPT, paymentMethod: "BANK_TRANSFER", payment: null }}
        link="https://app.sara.ng/r/pub_rcp_1"
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain(">Edit</button>");
  });

  it("does not render Edit button when onEdit is omitted", () => {
    const html = renderToStaticMarkup(
      <ReceiptRow
        receipt={{ ...BASE_RECEIPT, paymentMethod: "CASH", payment: null }}
        link="https://app.sara.ng/r/pub_rcp_1"
      />,
    );

    expect(html).not.toContain(">Edit</button>");
  });

  it("does not render Edit button when receipt is linked to an invoice payment", () => {
    const html = renderToStaticMarkup(
      <ReceiptRow
        receipt={{
          ...BASE_RECEIPT,
          paymentMethod: "CASH",
          payment: {
            id: "pay_1",
            invoiceId: "inv_1",
            amount: "15000",
            method: "CASH",
            reference: null,
            businessId: "biz_1",
            bookingId: null,
            clientName: null,
            clientEmail: null,
            clientPhone: null,
            createdAt: "2026-10-05T00:00:00.000Z",
            updatedAt: "2026-10-05T00:00:00.000Z",
            invoice: { id: "inv_1", slug: "inv-1", invoiceNumber: "INV-1001" },
          },
        }}
        link="https://app.sara.ng/r/pub_rcp_1"
        onEdit={vi.fn()}
      />,
    );

    expect(html).not.toContain(">Edit</button>");
  });

  it("does not render Edit button for automated payment methods like PAYSTACK or CARD", () => {
    const html = renderToStaticMarkup(
      <ReceiptRow
        receipt={{
          ...BASE_RECEIPT,
          paymentMethod: "CARD" as any,
          payment: null,
        }}
        link="https://app.sara.ng/r/pub_rcp_1"
        onEdit={vi.fn()}
      />,
    );

    expect(html).not.toContain(">Edit</button>");
  });
});

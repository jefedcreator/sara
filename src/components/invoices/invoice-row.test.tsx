import { renderToStaticMarkup } from "react-dom/server";
import type { InvoiceDto } from "types";
import { describe, expect, it, vi } from "vitest";

import { InvoiceRow } from "./invoice-row";

const BASE_INVOICE: InvoiceDto = {
  id: "inv_1",
  slug: "inv-1",
  publicId: "pub_inv_1",
  businessId: "biz_1",
  bookingId: null,
  invoiceNumber: "INV-1001",
  status: "DRAFT",
  currency: "NGN",
  clientName: "Ada Lovelace",
  clientEmail: "ada@example.com",
  clientPhone: "+2348012345678",
  subtotal: "25000",
  taxAmount: "0",
  discount: "0",
  total: "25000",
  amountPaid: "0",
  dueAt: "2026-11-01T00:00:00.000Z",
  sentAt: null,
  paidAt: null,
  notes: "Urgent delivery",
  url: "https://cdn.test/inv.pdf",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  services: [
    {
      invoiceId: "inv_1",
      serviceId: "srv_1",
      description: "Braids",
      quantity: 1,
      unitPrice: "25000",
      total: "25000",
      service: { id: "srv_1", name: "Braids" } as any,
    },
  ],
  business: { id: "biz_1", name: "Sara Salon" } as any,
  booking: null,
  payments: [],
  _count: { payments: 0 },
};

describe("InvoiceRow component", () => {
  it("renders Edit button when invoice is DRAFT and amountPaid is 0 and onEdit is passed", () => {
    const html = renderToStaticMarkup(
      <InvoiceRow
        invoice={{ ...BASE_INVOICE, status: "DRAFT", amountPaid: "0" }}
        link="https://app.sara.ng/i/pub_inv_1"
        busy={false}
        onRecordPayment={vi.fn()}
        onSend={vi.fn()}
        onVoid={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain(">Edit</button>");
  });

  it("renders Edit button when invoice is SENT and amountPaid is 0", () => {
    const html = renderToStaticMarkup(
      <InvoiceRow
        invoice={{ ...BASE_INVOICE, status: "SENT", amountPaid: "0" }}
        link="https://app.sara.ng/i/pub_inv_1"
        busy={false}
        onRecordPayment={vi.fn()}
        onSend={vi.fn()}
        onVoid={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain(">Edit</button>");
  });

  it("renders Edit button when invoice is OVERDUE and amountPaid is 0", () => {
    const html = renderToStaticMarkup(
      <InvoiceRow
        invoice={{ ...BASE_INVOICE, status: "OVERDUE", amountPaid: "0" }}
        link="https://app.sara.ng/i/pub_inv_1"
        busy={false}
        onRecordPayment={vi.fn()}
        onSend={vi.fn()}
        onVoid={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain(">Edit</button>");
  });

  it("does not render Edit button when onEdit is omitted", () => {
    const html = renderToStaticMarkup(
      <InvoiceRow
        invoice={{ ...BASE_INVOICE, status: "DRAFT", amountPaid: "0" }}
        link="https://app.sara.ng/i/pub_inv_1"
        busy={false}
        onRecordPayment={vi.fn()}
        onSend={vi.fn()}
        onVoid={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).not.toContain(">Edit</button>");
  });

  it("does not render Edit button when invoice is PAID", () => {
    const html = renderToStaticMarkup(
      <InvoiceRow
        invoice={{ ...BASE_INVOICE, status: "PAID", amountPaid: "25000" }}
        link="https://app.sara.ng/i/pub_inv_1"
        busy={false}
        onRecordPayment={vi.fn()}
        onSend={vi.fn()}
        onVoid={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(html).not.toContain(">Edit</button>");
  });

  it("does not render Edit button when invoice is PARTIALLY_PAID", () => {
    const html = renderToStaticMarkup(
      <InvoiceRow
        invoice={{ ...BASE_INVOICE, status: "PARTIALLY_PAID", amountPaid: "5000" }}
        link="https://app.sara.ng/i/pub_inv_1"
        busy={false}
        onRecordPayment={vi.fn()}
        onSend={vi.fn()}
        onVoid={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(html).not.toContain(">Edit</button>");
  });

  it("does not render Edit button when invoice has amountPaid > 0 even if status is SENT", () => {
    const html = renderToStaticMarkup(
      <InvoiceRow
        invoice={{ ...BASE_INVOICE, status: "SENT", amountPaid: "100" }}
        link="https://app.sara.ng/i/pub_inv_1"
        busy={false}
        onRecordPayment={vi.fn()}
        onSend={vi.fn()}
        onVoid={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(html).not.toContain(">Edit</button>");
  });

  it("disables Edit button when busy is true", () => {
    const html = renderToStaticMarkup(
      <InvoiceRow
        invoice={{ ...BASE_INVOICE, status: "DRAFT", amountPaid: "0" }}
        link="https://app.sara.ng/i/pub_inv_1"
        busy={true}
        onRecordPayment={vi.fn()}
        onSend={vi.fn()}
        onVoid={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain("disabled");
    expect(html).toContain(">Edit</button>");
  });
});

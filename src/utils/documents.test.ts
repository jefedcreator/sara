import { describe, expect, it } from "vitest";
import type { InvoiceDto, ReceiptDto } from "types";

import type { DocumentFormSchema } from "@/backend/validators/document-form.validator";

import { computeTotals, documentToFormValues, toDocumentPayload } from "./documents";

const base: DocumentFormSchema = {
  name: "Ada",
  email: "",
  phone: "",
  mode: "services",
  items: [],
  amount: "",
  description: "",
  taxAmount: "",
  discount: "",
  dueAt: "",
  paymentMethod: "CASH",
};

describe("computeTotals", () => {
  it("adds line items, tax and discount", () => {
    expect(
      computeTotals({
        ...base,
        items: [
          { serviceId: "s1", quantity: "2", unitPrice: "12,500" },
          { serviceId: "s2", quantity: "1", unitPrice: "5000" },
        ],
        taxAmount: "2250",
        discount: "1,000",
      }),
    ).toEqual({ subtotal: 30000, taxAmount: 2250, discount: 1000, total: 31250 });
  });

  it("uses the custom amount in amount mode and ignores items", () => {
    expect(
      computeTotals({
        ...base,
        mode: "amount",
        amount: "15000",
        items: [{ serviceId: "s1", quantity: "1", unitPrice: "99" }],
      }),
    ).toEqual({ subtotal: 15000, taxAmount: 0, discount: 0, total: 15000 });
  });

  it("never goes below zero and skips half-filled rows", () => {
    expect(
      computeTotals({
        ...base,
        items: [
          { serviceId: "s1", quantity: "1", unitPrice: "1000" },
          { serviceId: "", quantity: "1", unitPrice: "500" },
        ],
        discount: "5000",
      }).total,
    ).toBe(0);
  });
});

describe("toDocumentPayload", () => {
  it("drops empty optional fields and carries line items", () => {
    const payload = toDocumentPayload(
      { ...base, items: [{ serviceId: "s1", quantity: "1", unitPrice: "25000" }] },
      "NGN",
    );
    expect(payload).toEqual({
      name: "Ada",
      email: undefined,
      phone: undefined,
      currency: "NGN",
      subtotal: 25000,
      taxAmount: 0,
      discount: 0,
      total: 25000,
      notes: undefined,
      services: [{ serviceId: "s1", quantity: 1, unitPrice: 25000, total: 25000 }],
    });
  });

  it("puts a custom amount's description in the notes, with no items", () => {
    const payload = toDocumentPayload(
      { ...base, mode: "amount", amount: "15000", description: "Wig install" },
      "NGN",
    );
    expect(payload.services).toBeUndefined();
    expect(payload.notes).toBe("Wig install");
    expect(payload.total).toBe(15000);
  });
});

const MOCK_INVOICE: InvoiceDto = {
  id: "inv_1",
  slug: "inv-1",
  publicId: "pub_inv_1",
  businessId: "biz_1",
  bookingId: null,
  invoiceNumber: "INV-1001",
  status: "SENT",
  currency: "NGN",
  clientName: "Ada Lovelace",
  clientEmail: "ada@example.com",
  clientPhone: "+2348012345678",
  subtotal: "25000",
  taxAmount: "1875",
  discount: "1000",
  total: "25875",
  amountPaid: "0",
  dueAt: "2026-11-01T00:00:00.000Z",
  sentAt: "2026-10-01T00:00:00.000Z",
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

const MOCK_RECEIPT: ReceiptDto = {
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

describe("documentToFormValues", () => {
  it("converts an itemized invoice to DocumentFormSchema", () => {
    const values = documentToFormValues(MOCK_INVOICE, "invoice");
    expect(values.name).toBe("Ada Lovelace");
    expect(values.email).toBe("ada@example.com");
    expect(values.phone).toBe("+2348012345678");
    expect(values.mode).toBe("services");
    expect(values.items).toHaveLength(1);
    expect(values.items[0]).toEqual({
      serviceId: "srv_1",
      quantity: "1",
      unitPrice: "25000",
    });
    expect(values.taxAmount).toBe("1875");
    expect(values.discount).toBe("1000");
    expect(values.dueAt).toBe("2026-11-01");
    expect(values.description).toBe("Urgent delivery");
  });

  it("converts a custom amount receipt to DocumentFormSchema", () => {
    const values = documentToFormValues(MOCK_RECEIPT, "receipt");
    expect(values.name).toBe("Bisi Akande");
    expect(values.email).toBe("bisi@example.com");
    expect(values.mode).toBe("amount");
    expect(values.amount).toBe("15000");
    expect(values.items).toEqual([]);
    expect(values.paymentMethod).toBe("CASH");
    expect(values.description).toBe("Walk-in payment");
  });

  it("handles BANK_TRANSFER payment method on receipt", () => {
    const values = documentToFormValues(
      { ...MOCK_RECEIPT, paymentMethod: "BANK_TRANSFER" },
      "receipt",
    );
    expect(values.paymentMethod).toBe("BANK_TRANSFER");
  });

  it("handles invoice without due date and with empty tax and discount", () => {
    const values = documentToFormValues(
      {
        ...MOCK_INVOICE,
        dueAt: null,
        taxAmount: "0",
        discount: "0",
        clientEmail: null,
        clientPhone: null,
      },
      "invoice",
    );
    expect(values.dueAt).toBe("");
    expect(values.taxAmount).toBe("");
    expect(values.discount).toBe("");
    expect(values.email).toBe("");
    expect(values.phone).toBe("");
  });

  it("converts dueAt when provided as a Date object", () => {
    const values = documentToFormValues(
      { ...MOCK_INVOICE, dueAt: new Date("2026-11-01T00:00:00.000Z") as any },
      "invoice",
    );
    expect(values.dueAt).toBe("2026-11-01");
  });
});


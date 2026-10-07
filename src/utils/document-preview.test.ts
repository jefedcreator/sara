import type { InvoiceDto, ReceiptDto } from "types";
import { describe, expect, it } from "vitest";

import { invoicePreview, PREVIEW_ITEMS, receiptPreview } from "./document-preview";

const business = {
  id: "b",
  ownerId: "o",
  name: "Tolu's Hair Studio",
  slug: "t",
  email: "hello@tolu.example.com",
  phone: "+234 803 555 0142",
  address: "12 Admiralty Way",
  city: "Lekki",
  state: " ",
  country: "Nigeria",
  logoUrl: null,
  currency: "NGN",
};

const line = (name: string, description: string | null, quantity = 1) => ({
  description,
  quantity,
  unitPrice: "3000",
  total: String(3000 * quantity),
  service: { name },
});

const INVOICE = {
  invoiceNumber: "INV-1012",
  status: "PARTIALLY_PAID",
  clientName: "Adaeze Okafor",
  clientEmail: "adaeze@example.com",
  clientPhone: null,
  currency: "NGN",
  createdAt: "2026-09-30T09:00:00.000Z",
  sentAt: "2026-10-01T09:00:00.000Z",
  dueAt: "2026-10-12T00:00:00.000Z",
  paidAt: null,
  business,
  services: [line("Knotless braids", ""), line("Extensions", "Hair extensions, colour 1B", 3)],
} as unknown as InvoiceDto;

const RECEIPT = {
  receiptNumber: "RCP-1007",
  name: null,
  email: null,
  phone: "+234 803 555 0199",
  currency: "NGN",
  createdAt: "2026-09-29T10:00:00.000Z",
  paymentMethod: "BANK_TRANSFER",
  business,
  services: [line("Gele tying", null)],
} as unknown as ReceiptDto;

describe("invoicePreview", () => {
  it("reads what the PDF's first page shows, in its labels and order", () => {
    expect(invoicePreview(INVOICE)).toEqual({
      kind: "Invoice",
      number: "INV-1012",
      business: {
        name: "Tolu's Hair Studio",
        lines: ["hello@tolu.example.com", "+234 803 555 0142", "Lekki, Nigeria"],
      },
      client: { name: "Adaeze Okafor", lines: ["adaeze@example.com"] },
      pill: { label: "Partially paid", tone: "accent" },
      meta: [
        ["Issued", "1 Oct 2026"],
        ["Due", "12 Oct 2026"],
      ],
      currency: "NGN",
      items: [
        { description: "Knotless braids", quantity: 1, unitPrice: "3000", total: "3000" },
        { description: "Hair extensions, colour 1B", quantity: 3, unitPrice: "3000", total: "9000" },
      ],
    });
  });

  it("dates a draft by when it was made, and shows a paid date once paid", () => {
    const draft = invoicePreview({ ...INVOICE, sentAt: null, dueAt: null });
    expect(draft.meta).toEqual([["Issued", "30 Sep 2026"]]);
    const paid = invoicePreview({ ...INVOICE, paidAt: "2026-10-05T09:00:00.000Z" });
    expect(paid.meta.at(-1)).toEqual(["Paid", "5 Oct 2026"]);
  });

  it("keeps only the lines that fit the top of the page", () => {
    const many = Array.from({ length: PREVIEW_ITEMS + 3 }, (_, i) => line(`Service ${i}`, null));
    expect(invoicePreview({ ...INVOICE, services: many } as InvoiceDto).items).toHaveLength(
      PREVIEW_ITEMS,
    );
  });
});

describe("receiptPreview", () => {
  it("reads a receipt's first page: paid on, paid by, and a nameless customer as Client", () => {
    expect(receiptPreview(RECEIPT)).toMatchObject({
      kind: "Receipt",
      number: "RCP-1007",
      client: { name: "Client", lines: ["+234 803 555 0199"] },
      pill: { label: "Paid", tone: "accent" },
      meta: [
        ["Paid on", "29 Sep 2026"],
        ["Paid by", "Bank transfer"],
      ],
      items: [{ description: "Gele tying", quantity: 1, unitPrice: "3000", total: "3000" }],
    });
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: { invoice: { findUnique: vi.fn() }, receipt: { findUnique: vi.fn() } },
}));

import { db } from "@/server/db";

import { getSharedInvoice, getSharedReceipt } from "./documents";

const mockedDb = db as any;

const INVOICE_ROW = {
  invoiceNumber: "INV-1012",
  status: "PARTIALLY_PAID",
  clientName: "Ada Okafor",
  currency: "NGN",
  subtotal: 62000,
  taxAmount: 0,
  discount: 0,
  total: 62000,
  amountPaid: 20000,
  sentAt: new Date("2026-10-01T09:00:00.000Z"),
  createdAt: new Date("2026-09-30T09:00:00.000Z"),
  dueAt: new Date("2026-10-12T00:00:00.000Z"),
  notes: null,
  url: "https://cdn.test/INV-1012.pdf",
  business: { name: "Acme Salon" },
  services: [
    { description: "", quantity: 1, unitPrice: 53000, total: 53000, service: { name: "Knotless braids" } },
    { description: "Hair extensions, colour 1B", quantity: 3, unitPrice: 3000, total: 9000, service: { name: "Extensions" } },
  ],
};

const RECEIPT_ROW = {
  receiptNumber: "RCP-1007",
  name: "Ada Okafor",
  currency: "NGN",
  subtotal: 15000,
  taxAmount: 0,
  discount: 0,
  total: 15000,
  amountPaid: 15000,
  paymentMethod: "BANK_TRANSFER",
  createdAt: new Date("2026-09-29T10:00:00.000Z"),
  notes: null,
  url: null,
  business: { name: "Acme Salon" },
  services: [],
};

const selectOf = (mock: any) => mock.mock.calls[0][0].select;

beforeEach(() => vi.clearAllMocks());

describe("getSharedInvoice", () => {
  it("looks the invoice up by its public id alone", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(INVOICE_ROW);
    const doc = await getSharedInvoice("Xk39fjQ2aB7mN0pR");
    expect(mockedDb.invoice.findUnique.mock.calls[0][0].where).toEqual({
      publicId: "Xk39fjQ2aB7mN0pR",
    });
    expect(doc).toMatchObject({
      kind: "invoice",
      number: "INV-1012",
      businessName: "Acme Salon",
      balance: 42000,
      lines: [
        { description: "Knotless braids", quantity: 1, unitPrice: 53000, total: 53000 },
        { description: "Hair extensions, colour 1B", quantity: 3, unitPrice: 3000, total: 9000 },
      ],
    });
  });

  it("returns null for an unknown id", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(null);
    expect(await getSharedInvoice("nope")).toBeNull();
  });

  it("never reads the customer's contact details", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(null);
    await getSharedInvoice("x");
    const select = selectOf(mockedDb.invoice.findUnique);
    expect(select).not.toHaveProperty("clientEmail");
    expect(select).not.toHaveProperty("clientPhone");
    expect(select.business.select).toEqual({ name: true });
  });
});

describe("getSharedReceipt", () => {
  it("looks the receipt up by its public id alone", async () => {
    mockedDb.receipt.findUnique.mockResolvedValue(RECEIPT_ROW);
    const doc = await getSharedReceipt("b7T0qLm2Vn9cZ4wE");
    expect(mockedDb.receipt.findUnique.mock.calls[0][0].where).toEqual({
      publicId: "b7T0qLm2Vn9cZ4wE",
    });
    expect(doc).toMatchObject({
      kind: "receipt",
      number: "RCP-1007",
      paymentMethod: "Bank transfer",
      balance: 0,
    });
  });

  it("returns null for an unknown id and never reads contact details", async () => {
    mockedDb.receipt.findUnique.mockResolvedValue(null);
    expect(await getSharedReceipt("nope")).toBeNull();
    const select = selectOf(mockedDb.receipt.findUnique);
    expect(select).not.toHaveProperty("email");
    expect(select).not.toHaveProperty("phone");
  });
});

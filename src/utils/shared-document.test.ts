import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://app.sara.ng" },
}));

import {
  documentLead,
  documentLines,
  documentMetadata,
  type SharedDocument,
} from "./shared-document";

const INVOICE: SharedDocument = {
  kind: "invoice",
  number: "INV-1012",
  status: { label: "Unpaid", tone: "muted" },
  voided: false,
  businessName: "Acme Hair",
  customerName: "Ada",
  currency: "NGN",
  lines: [],
  subtotal: 15000,
  taxAmount: 0,
  discount: 0,
  total: 15000,
  amountPaid: 0,
  balance: 15000,
  issuedAt: "2026-09-29T10:00:00.000Z",
  dueAt: "2026-10-12T00:00:00.000Z",
  paymentMethod: null,
  notes: "gele",
  pdfUrl: "https://cdn.test/INV-1012.pdf",
};

const PATH = "/invoices/Xk39fjQ2aB7mN0pR";

describe("documentMetadata", () => {
  it("previews an unpaid invoice by what's owed and when", () => {
    const metadata = documentMetadata(INVOICE, PATH);
    expect(metadata.title).toBe("Invoice INV-1012 from Acme Hair");
    expect(metadata.description).toBe(
      "NGN 15,000 to pay, due 12 Oct 2026. See it here or download the PDF.",
    );
    expect(metadata.openGraph).toMatchObject({
      title: "Invoice INV-1012 from Acme Hair",
      url: "https://app.sara.ng/invoices/Xk39fjQ2aB7mN0pR",
    });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("says a paid invoice is paid, and a void one is void", () => {
    const paid = {
      ...INVOICE,
      status: { label: "Paid", tone: "accent" as const },
      amountPaid: 15000,
      balance: 0,
    };
    expect(documentMetadata(paid, PATH).description).toMatch(
      /^NGN 15,000, paid in full\./,
    );
    const voided = { ...INVOICE, voided: true, balance: 0 };
    expect(documentMetadata(voided, PATH).description).toMatch(
      /^This invoice was voided\./,
    );
  });

  it("previews a receipt by what was paid, to whom, and when", () => {
    const receipt: SharedDocument = {
      ...INVOICE,
      kind: "receipt",
      number: "RCP-1007",
      status: { label: "Paid", tone: "accent" },
      amountPaid: 15000,
      balance: 0,
      dueAt: null,
    };
    const metadata = documentMetadata(receipt, "/receipts/b7T0qLm2Vn9cZ4wE");
    expect(metadata.title).toBe("Receipt RCP-1007 from Acme Hair");
    expect(metadata.description).toMatch(
      /^NGN 15,000 paid to Acme Hair on 29 Sept? 2026\./,
    );
  });

  it("gives a missing document a not-found preview that isn't indexed", () => {
    const metadata = documentMetadata(null, "/invoices/nope");
    expect(metadata.title).toBe("Link not found · Sara");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("documentLines", () => {
  it("stands the note in for the lines of a chat invoice", () => {
    expect(documentLines(INVOICE)).toEqual([
      { description: "gele", quantity: 1, unitPrice: 15000, total: 15000 },
    ]);
  });

  it("keeps real lines as they are", () => {
    const lines = [{ description: "Braids", quantity: 2, unitPrice: 15000, total: 30000 }];
    expect(documentLines({ ...INVOICE, lines })).toBe(lines);
  });
});

describe("documentLead", () => {
  it("leads an invoice with what's still owed", () => {
    expect(documentLead({ ...INVOICE, total: 32000, amountPaid: 10000, balance: 22000 })).toEqual({
      label: "Balance due",
      amount: 22000,
    });
  });

  it("leads a settled or voided invoice with its total", () => {
    expect(documentLead({ ...INVOICE, amountPaid: 15000, balance: 0 })).toEqual({
      label: "Total",
      amount: 15000,
    });
    expect(documentLead({ ...INVOICE, voided: true, balance: 0 })).toEqual({
      label: "Total",
      amount: 15000,
    });
  });

  it("leads a receipt with what was paid", () => {
    expect(
      documentLead({ ...INVOICE, kind: "receipt", amountPaid: 15000, balance: 0 }),
    ).toEqual({ label: "Amount paid", amount: 15000 });
  });
});

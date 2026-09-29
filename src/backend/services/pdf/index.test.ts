import { describe, expect, it } from "vitest";

import {
  generateInvoicePdf,
  generateReceiptPdf,
  type InvoicePdfData,
} from "./index";

const invoice: InvoicePdfData = {
  invoiceNumber: "INV-0139",
  status: "PARTIALLY_PAID",
  currency: "NGN",
  subtotal: "24000",
  taxAmount: "1800",
  discount: "800",
  total: "25000",
  amountPaid: "10000",
  dueAt: new Date("2026-10-06T12:00:00Z"),
  sentAt: new Date("2026-09-29T12:00:00Z"),
  notes: "Deposit paid. Balance on the wedding day.",
  business: { name: "Glow by Kemi", email: "hello@glow.test", city: "Lagos" },
  client: { name: "Adébáyọ̀ (Kemi) Adeyemi", phone: "08012345678" },
  items: [
    {
      description: "Bridal makeup (wedding day)",
      quantity: 1,
      unitPrice: "18000",
      total: "18000",
    },
    {
      description: "Gele tying",
      quantity: 1,
      unitPrice: "6000",
      total: "6000",
    },
  ],
};

const text = (pdf: Buffer) => pdf.toString("latin1");
const pageCount = (pdf: Buffer) => /\/Count (\d+)/.exec(text(pdf))?.[1];

describe("generateInvoicePdf", () => {
  it("writes a PDF in the app's product language", async () => {
    const pdf = await generateInvoicePdf(invoice);
    const body = text(pdf);
    expect(body.startsWith("%PDF-1.4")).toBe(true);
    expect(body).toContain("(Partially paid)");
    expect(body).not.toContain("PARTIALLY_PAID");
    expect(body).toContain("(NGN 25,000)");
    expect(body).toContain("(Balance due)");
    expect(body).toContain("(6 Oct 2026)");
  });

  it("encodes text as WinAnsi, keeping Latin-1 accents and escaping parens", async () => {
    const body = text(await generateInvoicePdf(invoice));
    expect(body).toContain("/Encoding /WinAnsiEncoding");
    // é and á survive; ọ̀ loses its marks; parentheses are escaped.
    expect(body).toContain("(Adébáyo \\(Kemi\\) Adeyemi)");
  });

  it("breaks long item lists across pages", async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      description: `Service ${i + 1}`,
      quantity: 1,
      unitPrice: "1000",
      total: "1000",
    }));
    const pdf = await generateInvoicePdf({ ...invoice, items });
    expect(Number(pageCount(pdf))).toBeGreaterThan(1);
    expect(text(pdf)).toContain("Page 1 of");
  });

  it("points every xref entry at its object", async () => {
    const pdf = await generateInvoicePdf(invoice);
    const body = text(pdf);
    const xref = body.slice(body.lastIndexOf("xref"));
    const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    offsets.forEach((offset, index) => {
      expect(body.slice(offset, offset + 12)).toMatch(
        new RegExp(`^${index + 1} 0 obj`),
      );
    });
  });
});

describe("generateReceiptPdf", () => {
  it("shows it paid, with the method in words", async () => {
    const body = text(
      await generateReceiptPdf({
        ...invoice,
        receiptNumber: "RCP-0412",
        paymentMethod: "BANK_TRANSFER",
        amountPaid: "25000",
        paidAt: new Date("2026-09-29T12:00:00Z"),
      }),
    );
    expect(body).toContain("(Paid)");
    expect(body).toContain("(Bank transfer)");
    expect(body).not.toContain("BANK_TRANSFER");
    expect(body).toContain("(Amount paid)");
  });
});

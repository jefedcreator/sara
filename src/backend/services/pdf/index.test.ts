import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  generateInvoicePdf,
  renderInvoicePdf,
  renderReceiptPdf,
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
  client: { name: "Adébáyọ̀ Adeyemi", phone: "08012345678" },
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

/** The BaseFont names embedded in a PDF, e.g. "ABCDEF+HankenGrotesk-Regular". */
async function fontNames(pdf: Buffer) {
  const doc = await PDFDocument.load(pdf);
  return doc.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter(
      (object): object is PDFDict =>
        object instanceof PDFDict &&
        object.get(PDFName.of("Type")) === PDFName.of("Font"),
    )
    .map((font) => font.get(PDFName.of("BaseFont"))?.toString() ?? "");
}

describe("renderInvoicePdf", () => {
  it("writes the invoice in the app's product language", async () => {
    const { text } = await renderInvoicePdf(invoice);
    expect(text).toContain("Partially paid");
    expect(text).not.toContain("PARTIALLY_PAID");
    expect(text).toContain("NGN 25,000");
    expect(text).toContain("Balance due");
    expect(text).toContain("NGN 15,000");
    expect(text).toContain("6 Oct 2026");
  });

  it("embeds the app's fonts", async () => {
    const names = await fontNames(await generateInvoicePdf(invoice));
    expect(names.some((n) => n.includes("HankenGrotesk-Regular"))).toBe(true);
    expect(names.some((n) => n.includes("HankenGrotesk-SemiBold"))).toBe(true);
    expect(names.some((n) => n.includes("BricolageGrotesque"))).toBe(true);
  });

  it("keeps accented letters and drops marks it cannot place", async () => {
    const { text } = await renderInvoicePdf(invoice);
    // é, á and ọ are single glyphs; the tone mark on ọ̀ has no composed form.
    expect(text).toContain("Adébáyọ Adeyemi");
  });

  it("breaks long item lists across pages", async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      description: `Service ${i + 1}`,
      quantity: 1,
      unitPrice: "1000",
      total: "1000",
    }));
    const { pdf, pageCount, text } = await renderInvoicePdf({
      ...invoice,
      items,
    });
    expect(pageCount).toBeGreaterThan(1);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(pageCount);
    expect(text).toContain(`INV-0139 · Page 1 of ${pageCount}`);
  });
});

describe("renderReceiptPdf", () => {
  it("shows it paid, with the method in words", async () => {
    const { text } = await renderReceiptPdf({
      ...invoice,
      receiptNumber: "RCP-0412",
      paymentMethod: "BANK_TRANSFER",
      amountPaid: "25000",
      paidAt: new Date("2026-09-29T12:00:00Z"),
    });
    expect(text).toContain("Paid");
    expect(text).toContain("Bank transfer");
    expect(text).not.toContain("BANK_TRANSFER");
    expect(text).toContain("Amount paid");
  });
});

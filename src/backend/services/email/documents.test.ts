import type { Invoice, Receipt } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://app.sara.ng",
    AUTH_SECRET: "test-secret",
  },
}));
vi.mock("./index", () => ({
  emailService: {
    sendInvoiceEmail: vi.fn().mockResolvedValue({ success: true }),
    sendReceiptEmail: vi.fn().mockResolvedValue({ success: true }),
  },
}));

import { emailInvoice, emailReceipt } from "./documents";
import { emailService } from "./index";

const business = { name: "Acme Salon", email: "hello@acme.test" };

const invoice = {
  slug: "acme-inv-1012",
  invoiceNumber: "INV-1012",
  status: "SENT",
  clientName: "Ada",
  clientEmail: "ada@example.com",
  total: { toString: () => "15000" },
  amountPaid: { toString: () => "0" },
  currency: "NGN",
  dueAt: null,
} as unknown as Invoice;

const receipt = {
  slug: "acme-rcp-1007",
  receiptNumber: "RCP-1007",
  name: "Ada",
  email: "ada@example.com",
  amountPaid: { toString: () => "15000" },
  currency: "NGN",
  createdAt: new Date("2026-09-29T10:00:00.000Z"),
  paymentMethod: "BANK_TRANSFER",
} as unknown as Receipt;

beforeEach(() => vi.clearAllMocks());

describe("emailInvoice", () => {
  it("sends a sent invoice to its customer, linking its share page", async () => {
    await emailInvoice(invoice, business);
    expect(emailService.sendInvoiceEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ada@example.com",
        number: "INV-1012",
        total: "15000",
        url: expect.stringMatching(
          /^https:\/\/app\.sara\.ng\/i\/acme-inv-1012\/[\w-]{16}$/,
        ),
      }),
    );
  });

  it("leaves drafts and invoices with no address alone", async () => {
    expect(
      await emailInvoice({ ...invoice, status: "DRAFT" }, business),
    ).toBeNull();
    expect(
      await emailInvoice({ ...invoice, clientEmail: null }, business),
    ).toBeNull();
    expect(emailService.sendInvoiceEmail).not.toHaveBeenCalled();
  });
});

describe("emailReceipt", () => {
  it("sends a receipt with the payment method labelled", async () => {
    await emailReceipt(receipt, business);
    expect(emailService.sendReceiptEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ada@example.com",
        method: "Bank transfer",
        url: expect.stringMatching(/\/r\/acme-rcp-1007\/[\w-]{16}$/),
      }),
    );
  });

  it("leaves a receipt with no address alone", async () => {
    expect(
      await emailReceipt({ ...receipt, email: null }, business),
    ).toBeNull();
    expect(emailService.sendReceiptEmail).not.toHaveBeenCalled();
  });
});

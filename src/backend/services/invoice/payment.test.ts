/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://app.sara.ng" },
}));

vi.mock("@/server/db", () => {
  const db: any = {
    payment: { findUnique: vi.fn(), create: vi.fn() },
    invoice: { findUnique: vi.fn(), update: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});

vi.mock("@/backend/services/paystack", () => ({
  paystackService: { initializeTransaction: vi.fn() },
}));

vi.mock("@/backend/services/receipt", () => ({
  receiptService: { create: vi.fn() },
}));

vi.mock("@/backend/services/order", () => ({
  orderService: { createFromInvoice: vi.fn() },
}));

vi.mock("@/backend/services/email/documents", () => ({
  emailReceipt: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/backend/services/messaging/notify", () => ({
  ownerNotifier: { notify: vi.fn().mockResolvedValue(undefined) },
}));

import { emailReceipt } from "@/backend/services/email/documents";
import { ownerNotifier } from "@/backend/services/messaging/notify";
import { orderService } from "@/backend/services/order";
import {
  paystackService,
  type SuccessfulPaymentData,
} from "@/backend/services/paystack";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";

import { invoicePayments } from "./payment";

const mockedDb = db as any;
const mockedPaystack = paystackService as any;
const mockedReceipt = receiptService as any;
const mockedOrders = orderService as any;
const mockedEmail = emailReceipt as any;
const mockedNotifier = ownerNotifier as any;

const INVOICE = {
  id: "inv_1",
  publicId: "inv_pub",
  businessId: "biz_1",
  customerId: "cus_1",
  invoiceNumber: "INV-1042",
  status: "PARTIALLY_PAID" as string,
  currency: "NGN",
  clientName: "Tolu Adeyemi",
  clientEmail: "tolu@example.com" as string | null,
  clientPhone: "08035550142",
  total: 50000,
  amountPaid: 20000,
  business: {
    id: "biz_1",
    name: "Tobi Hair",
    email: "hello@tobi.test",
    paystackSubaccountCode: "ACCT_1" as string | null,
  },
};

const paymentFor = (
  patch: Partial<SuccessfulPaymentData> = {},
): SuccessfulPaymentData => ({
  reference: "ref_inv_1",
  amount: 3_000_000,
  metadata: { invoiceId: INVOICE.id, businessId: INVOICE.businessId },
  customer: { email: "tolu@example.com" },
  channel: "card",
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.invoice.findUnique.mockResolvedValue(INVOICE);
  mockedDb.invoice.update.mockResolvedValue({});
  mockedDb.payment.findUnique.mockResolvedValue(null);
  mockedDb.payment.create.mockImplementation(async ({ data }: any) => ({
    id: "pay_1",
    ...data,
  }));
  mockedDb.$transaction.mockImplementation(async (cb: (tx: any) => unknown) =>
    cb(mockedDb),
  );
  mockedPaystack.initializeTransaction.mockResolvedValue({
    authorization_url: "https://paystack.test/pay",
    access_code: "ac",
    reference: "ref_new",
  });
  mockedReceipt.create.mockResolvedValue({ id: "rcp_1", publicId: "rcp_pub" });
  mockedOrders.createFromInvoice.mockResolvedValue(null);
  mockedEmail.mockResolvedValue(null);
  mockedNotifier.notify.mockResolvedValue(undefined);
});

describe("invoicePayments.start", () => {
  it("charges the whole remaining balance", async () => {
    const result = await invoicePayments.start("inv_pub");

    expect(result).toEqual({ paymentUrl: "https://paystack.test/pay" });
    expect(mockedPaystack.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 3_000_000,
        email: "tolu@example.com",
        subaccountCode: "ACCT_1",
        callbackUrl: "https://app.sara.ng/api/webhooks/paystack?i=inv_pub",
        metadata: expect.objectContaining({
          invoiceId: "inv_1",
          businessId: "biz_1",
        }),
      }),
    );
  });

  it.each(["DRAFT", "PAID", "VOID"])("refuses a %s invoice", async (status) => {
    mockedDb.invoice.findUnique.mockResolvedValue({ ...INVOICE, status });

    await expect(invoicePayments.start("inv_pub")).rejects.toThrow(
      "This invoice can't be paid online",
    );
    expect(mockedPaystack.initializeTransaction).not.toHaveBeenCalled();
  });

  it("refuses when the business can't take payments", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue({
      ...INVOICE,
      business: { ...INVOICE.business, paystackSubaccountCode: null },
    });

    await expect(invoicePayments.start("inv_pub")).rejects.toThrow(
      "not set up payment processing",
    );
    expect(mockedPaystack.initializeTransaction).not.toHaveBeenCalled();
  });

  it("is not found for an unknown invoice", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(null);

    await expect(invoicePayments.start("nope")).rejects.toThrow(
      "Invoice not found",
    );
  });
});

describe("invoicePayments.process", () => {
  it("a part payment leaves the invoice PARTIALLY_PAID", async () => {
    // 30,000 paid on top of 20,000 against 50,000 is settled; use a smaller charge.
    const result = await invoicePayments.process(
      paymentFor({ amount: 1_000_000 }),
    );

    expect(result).toEqual({ invoice: { publicId: "inv_pub" } });
    expect(mockedDb.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: "biz_1",
        invoiceId: "inv_1",
        customerId: "cus_1",
        amount: 10000,
        method: "PAYSTACK",
        reference: "ref_inv_1",
      }),
    });
    expect(mockedDb.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv_1" },
      data: { amountPaid: 30000, status: "PARTIALLY_PAID" },
    });
    expect(mockedDb.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("a full payment marks it PAID with paidAt", async () => {
    await invoicePayments.process(paymentFor());

    expect(mockedDb.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv_1" },
      data: {
        amountPaid: 50000,
        status: "PAID",
        paidAt: expect.any(Date),
      },
    });
  });

  it("ignores a reference it has already recorded", async () => {
    mockedDb.payment.findUnique.mockResolvedValue({
      id: "pay_old",
      invoice: { publicId: "inv_pub" },
    });

    const result = await invoicePayments.process(paymentFor());

    expect(result).toEqual({ invoice: { publicId: "inv_pub" } });
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
    expect(mockedDb.payment.create).not.toHaveBeenCalled();
    expect(mockedDb.invoice.update).not.toHaveBeenCalled();
    expect(mockedOrders.createFromInvoice).not.toHaveBeenCalled();
    expect(mockedReceipt.create).not.toHaveBeenCalled();
    expect(mockedEmail).not.toHaveBeenCalled();
    expect(mockedNotifier.notify).not.toHaveBeenCalled();
  });

  it("lands on the winner when a racing delivery takes the unique reference first", async () => {
    mockedDb.payment.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: "pay_win", invoice: { publicId: "inv_pub" } });
    mockedDb.$transaction.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const result = await invoicePayments.process(paymentFor());

    expect(result).toEqual({ invoice: { publicId: "inv_pub" } });
    expect(mockedDb.payment.create).not.toHaveBeenCalled();
    expect(mockedReceipt.create).not.toHaveBeenCalled();
    expect(mockedOrders.createFromInvoice).not.toHaveBeenCalled();
    expect(mockedNotifier.notify).not.toHaveBeenCalled();
  });

  it("records nothing when the business doesn't match", async () => {
    const result = await invoicePayments.process(
      paymentFor({ metadata: { invoiceId: "inv_1", businessId: "biz_other" } }),
    );

    expect(result).toBeNull();
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
    expect(mockedDb.payment.create).not.toHaveBeenCalled();
  });

  it("records nothing when the metadata has no invoice", async () => {
    const result = await invoicePayments.process(
      paymentFor({ metadata: { businessId: "biz_1" } }),
    );

    expect(result).toBeNull();
    expect(mockedDb.payment.create).not.toHaveBeenCalled();
  });

  it("creates the order on the first payment of a product invoice", async () => {
    await invoicePayments.process(paymentFor({ amount: 1_000_000 }));

    expect(mockedOrders.createFromInvoice).toHaveBeenCalledTimes(1);
    // Handed the transaction client (the $transaction mock passes the db mock),
    // so the stock and the order commit or roll back together.
    expect(mockedDb.$transaction).toHaveBeenCalledTimes(2);
    expect(mockedOrders.createFromInvoice).toHaveBeenCalledWith(
      mockedDb,
      "inv_1",
    );
  });

  it("creates the receipt from the payment, copying the invoice lines, and emails it", async () => {
    await invoicePayments.process(paymentFor());

    expect(mockedReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz_1",
        customerId: "cus_1",
        paymentId: "pay_1",
        name: "Tolu Adeyemi",
        email: "tolu@example.com",
        currency: "NGN",
        total: 30000,
        amountPaid: 30000,
        paymentMethod: "PAYSTACK",
      }),
    );
    // No lines passed: receiptService copies the invoice's lines for the payment.
    expect(mockedReceipt.create.mock.calls[0][0]).not.toHaveProperty("lines");
    expect(mockedEmail).toHaveBeenCalledWith(
      { id: "rcp_1", publicId: "rcp_pub" },
      expect.objectContaining({ name: "Tobi Hair" }),
    );
  });

  it("alerts the owner", async () => {
    await invoicePayments.process(paymentFor());

    expect(mockedNotifier.notify).toHaveBeenCalledWith(
      "biz_1",
      "💳 INV-1042 paid · Tolu Adeyemi · NGN 30,000",
    );
  });

  it("keeps the payment when the order, receipt or alert fail", async () => {
    mockedOrders.createFromInvoice.mockRejectedValue(new Error("boom"));
    mockedReceipt.create.mockRejectedValue(new Error("boom"));
    mockedNotifier.notify.mockRejectedValue(new Error("boom"));

    const result = await invoicePayments.process(paymentFor());

    expect(result).toEqual({ invoice: { publicId: "inv_pub" } });
    expect(mockedDb.payment.create).toHaveBeenCalledTimes(1);
  });
});

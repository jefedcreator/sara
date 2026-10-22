import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    payment: { findUnique: vi.fn(), create: vi.fn() },
    order: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    productOption: { findMany: vi.fn(), update: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});

vi.mock("@/backend/services/paystack", () => ({
  paystackService: { initializeTransaction: vi.fn() },
}));

vi.mock("@/backend/services/email", () => ({
  emailService: {
    sendOrderEmail: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("@/backend/services/receipt", () => ({
  receiptService: { create: vi.fn() },
}));

vi.mock("@/backend/services/messaging/notify", () => ({
  ownerNotifier: { notify: vi.fn().mockResolvedValue(undefined) },
}));

import { emailService } from "@/backend/services/email";
import { ownerNotifier } from "@/backend/services/messaging/notify";
import type { SuccessfulPaymentData } from "@/backend/services/paystack";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";

import { processOrderPayment } from "./payment";

const mockedDb = db as any;
const mockedEmail = emailService as any;
const mockedReceipt = receiptService as any;
const mockedNotifier = ownerNotifier as any;

const ORDER = {
  id: "ord_1",
  publicId: "ord_pub",
  slug: "tobi-hair-abc",
  businessId: "biz_1",
  customerId: "cus_1",
  orderNumber: null,
  status: "AWAITING_PAYMENT",
  source: "ONLINE",
  fulfilment: "DELIVERY" as const,
  deliveryAddress: "12 Admiralty Way",
  deliveryFee: 3000,
  subtotal: 90000,
  total: 93000,
  currency: "NGN",
  holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
  oversold: false,
  invoiceId: null,
  receiptId: null,
  clientName: "Tolu Adeyemi",
  clientPhone: "08035550142",
  clientEmail: "tolu@example.com" as string | null,
  notes: null,
  paidAt: null,
  readyAt: null,
  completedAt: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lines: [
    {
      id: "line_1",
      orderId: "ord_1",
      productOptionId: "opt_1" as string | null,
      name: 'Frontal wig — 20"',
      quantity: 2,
      unitPrice: 45000,
      total: 90000,
    },
  ],
  business: {
    id: "biz_1",
    name: "Tobi Hair",
    email: "hello@tobi.test",
    address: "1 Allen Avenue",
    currency: "NGN",
  },
};

const paymentFor = (
  patch: Partial<SuccessfulPaymentData> = {},
): SuccessfulPaymentData => ({
  reference: "ref_123",
  amount: 9_300_000,
  metadata: { orderId: ORDER.id, businessId: ORDER.businessId },
  customer: {
    email: "tolu@example.com",
    first_name: "Tolu",
    last_name: "Adeyemi",
  },
  channel: "card",
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.payment.findUnique.mockResolvedValue(null);
  mockedDb.payment.create.mockImplementation(async ({ data }: any) => ({
    id: "pay_1",
    ...data,
  }));
  mockedDb.order.findFirst.mockResolvedValue(null);
  mockedDb.order.findUnique.mockResolvedValue(ORDER);
  mockedDb.order.update.mockImplementation(async ({ data }: any) => ({
    ...ORDER,
    ...data,
  }));
  mockedDb.productOption.findMany.mockResolvedValue([
    { id: "opt_1", stock: 10, product: { tracksStock: true } },
  ]);
  mockedDb.productOption.update.mockResolvedValue({});
  mockedDb.$transaction.mockImplementation(async (cb: (tx: any) => unknown) =>
    cb(mockedDb),
  );

  mockedReceipt.create.mockResolvedValue({
    id: "rcp_1",
    publicId: "rcp_pub",
  });
  mockedEmail.sendOrderEmail.mockResolvedValue({ success: true });
  mockedNotifier.notify.mockResolvedValue(undefined);
});

describe("processOrderPayment", () => {
  it("marks the order NEW, numbers it, records the payment and takes the stock", async () => {
    const result = await processOrderPayment(paymentFor());

    expect(result).toEqual({ order: { publicId: "ord_pub" } });

    expect(mockedDb.order.update).toHaveBeenCalledWith({
      where: { id: "ord_1" },
      data: expect.objectContaining({
        status: "NEW",
        orderNumber: "ORD-1001",
        oversold: false,
        paidAt: expect.any(Date),
      }),
    });

    expect(mockedDb.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: "biz_1",
        orderId: "ord_1",
        customerId: "cus_1",
        amount: 93000,
        method: "PAYSTACK",
        reference: "ref_123",
        clientName: "Tolu Adeyemi",
        clientEmail: "tolu@example.com",
        clientPhone: "08035550142",
      }),
    });

    expect(mockedDb.productOption.update).toHaveBeenCalledWith({
      where: { id: "opt_1" },
      data: { stock: 8 },
    });
    expect(mockedDb.productOption.update).toHaveBeenCalledTimes(1);

    expect(mockedDb.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("sets oversold when a late payment finds the stock gone, and never goes below zero", async () => {
    mockedDb.productOption.findMany.mockResolvedValue([
      { id: "opt_1", stock: 1, product: { tracksStock: true } },
    ]);

    const result = await processOrderPayment(paymentFor());

    expect(result).toEqual({ order: { publicId: "ord_pub" } });
    expect(mockedDb.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ oversold: true }),
      }),
    );
    expect(mockedDb.productOption.update).toHaveBeenCalledWith({
      where: { id: "opt_1" },
      data: { stock: 0 },
    });
    expect(mockedNotifier.notify).toHaveBeenCalledWith(
      "biz_1",
      expect.stringContaining(
        "Paid after it sold out. Restock or refund the customer.",
      ),
    );
  });

  it("does nothing the second time a reference arrives", async () => {
    mockedDb.payment.findUnique.mockResolvedValue({
      id: "pay_old",
      order: { publicId: "ord_pub" },
    });

    const result = await processOrderPayment(paymentFor());

    expect(result).toEqual({ order: { publicId: "ord_pub" } });
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
    expect(mockedDb.order.update).not.toHaveBeenCalled();
    expect(mockedDb.payment.create).not.toHaveBeenCalled();
    expect(mockedDb.productOption.update).not.toHaveBeenCalled();
    expect(mockedReceipt.create).not.toHaveBeenCalled();
    expect(mockedEmail.sendOrderEmail).not.toHaveBeenCalled();
  });

  it("records nothing when the amount doesn't match", async () => {
    const result = await processOrderPayment(paymentFor({ amount: 9_000_000 }));

    expect(result).toBeNull();
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
    expect(mockedDb.payment.create).not.toHaveBeenCalled();
    expect(mockedDb.order.update).not.toHaveBeenCalled();
    expect(mockedDb.productOption.update).not.toHaveBeenCalled();
    expect(mockedReceipt.create).not.toHaveBeenCalled();
    expect(mockedNotifier.notify).not.toHaveBeenCalled();
  });

  it("records nothing when the business doesn't match", async () => {
    const result = await processOrderPayment(
      paymentFor({
        metadata: { orderId: ORDER.id, businessId: "biz_other" },
      }),
    );

    expect(result).toBeNull();
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
    expect(mockedDb.payment.create).not.toHaveBeenCalled();
  });

  it("finds the order by its slug when the metadata has no orderId", async () => {
    mockedDb.order.findUnique
      .mockResolvedValueOnce({ id: "ord_1" })
      .mockResolvedValueOnce(ORDER);

    const result = await processOrderPayment(
      paymentFor({ metadata: { orderSlug: ORDER.slug, businessId: "biz_1" } }),
    );

    expect(result).toEqual({ order: { publicId: "ord_pub" } });
    expect(mockedDb.order.findUnique).toHaveBeenCalledWith({
      where: { slug: ORDER.slug },
      select: { id: true },
    });
  });

  it("creates the receipt with the product lines and a Delivery line", async () => {
    await processOrderPayment(paymentFor());

    expect(mockedReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz_1",
        customerId: "cus_1",
        paymentId: "pay_1",
        paymentMethod: "PAYSTACK",
        currency: "NGN",
        subtotal: 90000,
        total: 93000,
        amountPaid: 93000,
        lines: [
          {
            productOptionId: "opt_1",
            name: 'Frontal wig — 20"',
            quantity: 2,
            unitPrice: 45000,
            total: 90000,
          },
          { name: "Delivery", quantity: 1, unitPrice: 3000, total: 3000 },
        ],
      }),
    );

    expect(mockedDb.order.update).toHaveBeenCalledWith({
      where: { id: "ord_1" },
      data: { receiptId: "rcp_1" },
    });
  });

  it("emails the customer the confirmed order with receipt and order links", async () => {
    await processOrderPayment(paymentFor());

    expect(mockedEmail.sendOrderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "confirmed",
        to: "tolu@example.com",
        orderNumber: "ORD-1001",
        total: 93000,
        currency: "NGN",
        fulfilment: "DELIVERY",
        deliveryAddress: "12 Admiralty Way",
        lines: [{ name: 'Frontal wig — 20"', quantity: 2, total: 90000 }],
        receiptUrl: expect.stringMatching(/\/receipts\/rcp_pub$/),
        orderUrl: expect.stringMatching(/\/orders\/ord_pub$/),
      }),
    );
  });

  it("does not email when the customer gave no email at checkout", async () => {
    mockedDb.order.findUnique.mockResolvedValue({
      ...ORDER,
      clientEmail: null,
    });

    await processOrderPayment(paymentFor());

    expect(mockedEmail.sendOrderEmail).not.toHaveBeenCalled();
  });
});

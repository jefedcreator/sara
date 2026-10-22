import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    product: { findFirst: vi.fn() },
    productOption: { findMany: vi.fn(), update: vi.fn() },
    order: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    orderLine: { groupBy: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});
vi.mock("@/backend/services/paystack", () => ({
  paystackService: {
    initializeTransaction: vi.fn().mockResolvedValue({
      authorization_url: "https://paystack.test/pay",
      reference: "ref_123",
    }),
  },
}));
vi.mock("@/backend/services/customer", () => ({
  customerService: {
    resolve: vi.fn(),
    ownedBy: vi.fn(),
  },
}));
vi.mock("@/backend/services/email", () => ({
  emailService: {
    sendOrderEmail: vi.fn().mockResolvedValue({ success: true }),
  },
}));

import { customerService } from "@/backend/services/customer";
import { emailService } from "@/backend/services/email";
import { paystackService } from "@/backend/services/paystack";
import { db } from "@/server/db";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@/utils/exceptions";
import {
  nextOrderNumber,
  orderService,
  type CheckoutInput,
  type OrderStatusChange,
} from "./index";

const mockedDb = db as any;
const mockedCustomer = customerService as any;
const mockedEmail = emailService as any;

const BUSINESS = {
  id: "biz_1",
  name: "Tobi Hair",
  slug: "tobi-hair",
  currency: "NGN",
  paystackSubaccountCode: "ACCT_1",
  offersDelivery: true,
  offersPickup: true,
  deliveryFee: 3000,
};

const OPTION = {
  id: "opt_1",
  productId: "prd_1",
  name: '20"',
  price: null as number | null,
  stock: 10,
  position: 0,
  isActive: true,
};

const PRODUCT = {
  id: "prd_1",
  slug: "frontal-wig",
  businessId: "biz_1",
  name: "Frontal wig",
  price: 45000,
  isActive: true,
  business: BUSINESS,
  options: [OPTION],
};

const INPUT: CheckoutInput = {
  productSlug: "frontal-wig",
  optionId: "opt_1",
  quantity: 2,
  fulfilment: "DELIVERY",
  deliveryAddress: "12 Admiralty Way",
  clientName: "Tolu Adeyemi",
  clientPhone: "08035550142",
  clientEmail: "tolu@example.com",
};

const checkout = (patch: Partial<CheckoutInput> = {}) =>
  orderService.startCheckout({ ...INPUT, ...patch });

/** A paid order as the owner's list, page and actions receive it. */
function makeOrder(patch: Record<string, unknown> = {}): any {
  return {
    id: "ord_1",
    slug: "tobi-hair-abc",
    publicId: "ord_pub",
    businessId: "biz_1",
    customerId: "cus_1",
    orderNumber: "ORD-1022",
    status: "NEW",
    source: "ONLINE",
    fulfilment: "DELIVERY",
    deliveryAddress: "12 Admiralty Way",
    deliveryFee: 3000,
    subtotal: 90000,
    total: 93000,
    currency: "NGN",
    holdExpiresAt: null,
    oversold: false,
    invoiceId: null,
    receiptId: "rcp_1",
    clientName: "Tolu Adeyemi",
    clientPhone: "08035550142",
    clientEmail: "tolu@example.com",
    notes: null,
    paidAt: new Date("2026-10-01T00:00:00.000Z"),
    readyAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    lines: [
      {
        id: "line_1",
        orderId: "ord_1",
        productOptionId: "opt_1",
        name: 'Frontal wig — 20"',
        quantity: 2,
        unitPrice: 45000,
        total: 90000,
      },
    ],
    customer: {
      id: "cus_1",
      name: "Tolu Adeyemi",
      phone: "+2348035550142",
      email: "tolu@example.com",
    },
    invoice: null,
    receipt: {
      id: "rcp_1",
      publicId: "rcp_pub",
      receiptNumber: "RCP-2210",
    },
    business: {
      id: "biz_1",
      name: "Tobi Hair",
      email: "hello@tobi.test",
      address: "1 Allen Avenue",
      deliveryFee: 3000,
    },
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCustomer.resolve.mockResolvedValue({ id: "cus_1" });
  mockedDb.product.findFirst.mockResolvedValue(PRODUCT);
  mockedDb.productOption.findMany.mockResolvedValue([
    { id: "opt_1", stock: 10, product: { tracksStock: true } },
  ]);
  mockedDb.productOption.update.mockResolvedValue({});
  mockedDb.orderLine.groupBy.mockResolvedValue([]);
  mockedDb.order.findFirst.mockResolvedValue(null);
  mockedDb.order.findUnique.mockResolvedValue(null);
  mockedDb.order.findMany.mockResolvedValue([]);
  mockedDb.order.count.mockResolvedValue(0);
  mockedDb.order.update.mockImplementation(async ({ data }: any) => ({
    ...makeOrder(),
    ...data,
  }));
  mockedDb.order.create.mockImplementation(async ({ data }: any) => ({
    id: "ord_1",
    publicId: "pub_1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  }));
  mockedDb.$transaction.mockImplementation(async (cb: (tx: any) => unknown) =>
    cb(mockedDb),
  );
  mockedEmail.sendOrderEmail.mockResolvedValue({ success: true });
  vi.mocked(paystackService.initializeTransaction).mockResolvedValue({
    authorization_url: "https://paystack.test/pay",
    reference: "ref_123",
    access_code: "access_1",
  });
});

describe("orderService.startCheckout", () => {
  it("holds the stock for 30 minutes and charges quantity × price + delivery fee", async () => {
    const before = Date.now();
    const result = await checkout();
    const after = Date.now();

    const data = mockedDb.order.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: "AWAITING_PAYMENT",
      source: "ONLINE",
      orderNumber: null,
      fulfilment: "DELIVERY",
      deliveryAddress: "12 Admiralty Way",
      currency: "NGN",
      clientName: "Tolu Adeyemi",
      clientPhone: "08035550142",
      clientEmail: "tolu@example.com",
      customerId: "cus_1",
    });
    expect(Number(data.subtotal)).toBe(90000);
    expect(Number(data.deliveryFee)).toBe(3000);
    expect(Number(data.total)).toBe(93000);
    expect(data.holdExpiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 30 * 60 * 1000,
    );
    expect(data.holdExpiresAt.getTime()).toBeLessThanOrEqual(
      after + 30 * 60 * 1000,
    );
    expect(data.lines.create[0]).toMatchObject({
      productOptionId: "opt_1",
      name: 'Frontal wig — 20"',
      quantity: 2,
      unitPrice: 45000,
      total: 90000,
    });

    expect(mockedDb.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "Serializable",
    });

    expect(mockedCustomer.resolve).toHaveBeenCalledWith(mockedDb, {
      businessId: "biz_1",
      name: "Tolu Adeyemi",
      phone: "08035550142",
      email: "tolu@example.com",
    });

    expect(result.paymentUrl).toBe("https://paystack.test/pay");
    expect(result.paymentReference).toBe("ref_123");
    expect(paystackService.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "tolu@example.com",
        amount: 9_300_000,
        subaccountCode: "ACCT_1",
        bearer: "account",
        metadata: expect.objectContaining({
          orderId: "ord_1",
          orderSlug: result.order.slug,
          businessId: "biz_1",
          businessName: "Tobi Hair",
          productId: "prd_1",
          productName: "Frontal wig",
          clientName: "Tolu Adeyemi",
        }),
      }),
    );

    const call = vi.mocked(paystackService.initializeTransaction).mock
      .calls[0]![0];
    expect(call.callbackUrl?.endsWith(`?o=${result.order.slug}`)).toBe(true);
  });

  it("uses the option's own price when it has one", async () => {
    mockedDb.product.findFirst.mockResolvedValue({
      ...PRODUCT,
      options: [{ ...OPTION, price: 50000 }],
    });

    await checkout();

    const data = mockedDb.order.create.mock.calls[0][0].data;
    expect(Number(data.subtotal)).toBe(100000);
    expect(Number(data.total)).toBe(103000);
    expect(data.lines.create[0].unitPrice).toBe(50000);
  });

  it("does not charge a delivery fee on pickup", async () => {
    await checkout({ fulfilment: "PICKUP", deliveryAddress: "ignored" });

    const data = mockedDb.order.create.mock.calls[0][0].data;
    expect(Number(data.deliveryFee)).toBe(0);
    expect(Number(data.total)).toBe(90000);
    expect(data.deliveryAddress).toBeNull();
  });

  it("refuses more than is available", async () => {
    mockedDb.productOption.findMany.mockResolvedValue([
      { id: "opt_1", stock: 4, product: { tracksStock: true } },
    ]);

    await expect(checkout({ quantity: 5 })).rejects.toThrow("Only 4 left");
    expect(mockedDb.order.create).not.toHaveBeenCalled();
    expect(paystackService.initializeTransaction).not.toHaveBeenCalled();
  });

  it("lets an untracked option sell any quantity", async () => {
    mockedDb.productOption.findMany.mockResolvedValue([
      { id: "opt_1", stock: 0, product: { tracksStock: false } },
    ]);

    await checkout({ quantity: 50 });

    expect(mockedDb.order.create).toHaveBeenCalledTimes(1);
  });

  it("falls back to customer@sara.app when the client gives no email", async () => {
    await checkout({ clientEmail: null });

    expect(paystackService.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ email: "customer@sara.app" }),
    );
    expect(mockedDb.order.create.mock.calls[0][0].data.clientEmail).toBeNull();
  });

  it("refuses a paused product", async () => {
    mockedDb.product.findFirst.mockResolvedValue({
      ...PRODUCT,
      isActive: false,
    });

    await expect(checkout()).rejects.toThrow(
      "This product is no longer available",
    );
    expect(mockedDb.order.create).not.toHaveBeenCalled();
  });

  it("refuses an option that was removed", async () => {
    mockedDb.product.findFirst.mockResolvedValue({ ...PRODUCT, options: [] });

    await expect(checkout()).rejects.toBeInstanceOf(BadRequestException);
    await expect(checkout()).rejects.toThrow(
      "This product is no longer available",
    );
    expect(mockedDb.order.create).not.toHaveBeenCalled();
  });

  it("refuses a missing product", async () => {
    mockedDb.product.findFirst.mockResolvedValue(null);

    await expect(checkout()).rejects.toThrow(
      "This product is no longer available",
    );
  });

  it("refuses delivery without an address", async () => {
    await expect(checkout({ deliveryAddress: null })).rejects.toThrow(
      "Enter a delivery address",
    );
    await expect(checkout({ deliveryAddress: "   " })).rejects.toThrow(
      "Enter a delivery address",
    );
    expect(mockedCustomer.resolve).not.toHaveBeenCalled();
  });

  it("refuses a fulfilment the business doesn't offer", async () => {
    mockedDb.product.findFirst.mockResolvedValue({
      ...PRODUCT,
      business: { ...BUSINESS, offersDelivery: false },
    });

    await expect(checkout()).rejects.toThrow(
      "This business doesn't offer delivery",
    );
    expect(mockedDb.order.create).not.toHaveBeenCalled();
  });

  it("refuses pickup when only delivery is offered", async () => {
    mockedDb.product.findFirst.mockResolvedValue({
      ...PRODUCT,
      business: { ...BUSINESS, offersPickup: false },
    });

    await expect(checkout({ fulfilment: "PICKUP" })).rejects.toThrow(
      "This business doesn't offer pickup",
    );
  });

  it("refuses when the business can't take payments", async () => {
    mockedDb.product.findFirst.mockResolvedValue({
      ...PRODUCT,
      business: { ...BUSINESS, paystackSubaccountCode: null },
    });

    await expect(checkout()).rejects.toThrow(
      "This business has not set up payment processing. Please contact the service provider.",
    );
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
    expect(paystackService.initializeTransaction).not.toHaveBeenCalled();
  });

  it("retries once on a serialization failure", async () => {
    mockedDb.$transaction.mockRejectedValueOnce({ code: "P2034" });

    const result = await checkout();

    expect(mockedDb.$transaction).toHaveBeenCalledTimes(2);
    expect(result.order.id).toBe("ord_1");
    expect(paystackService.initializeTransaction).toHaveBeenCalledTimes(1);
  });

  it("reports a conflict when the retry also loses the race", async () => {
    mockedDb.$transaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2034" });

    await expect(checkout()).rejects.toBeInstanceOf(ConflictException);
    expect(mockedDb.$transaction).toHaveBeenCalledTimes(2);
    expect(paystackService.initializeTransaction).not.toHaveBeenCalled();
  });
});

describe("nextOrderNumber", () => {
  it("starts at ORD-1001", async () => {
    mockedDb.order.findFirst.mockResolvedValue(null);

    await expect(nextOrderNumber(mockedDb, "biz_1")).resolves.toBe("ORD-1001");
  });

  it("follows the newest numbered order", async () => {
    mockedDb.order.findFirst.mockResolvedValue({ orderNumber: "ORD-1042" });

    await expect(nextOrderNumber(mockedDb, "biz_1")).resolves.toBe("ORD-1043");
    expect(mockedDb.order.findFirst).toHaveBeenCalledWith({
      where: { businessId: "biz_1", orderNumber: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { orderNumber: true },
    });
  });
});

describe("orderService.list", () => {
  it("lists orders without awaiting-payment ones, active ones first", async () => {
    mockedDb.order.findMany.mockResolvedValue([
      makeOrder({
        id: "ord_done_old",
        status: "COMPLETED",
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
      }),
      makeOrder({
        id: "ord_active_new",
        status: "NEW",
        createdAt: new Date("2026-10-05T00:00:00.000Z"),
      }),
      makeOrder({
        id: "ord_active_old",
        status: "READY",
        createdAt: new Date("2026-10-02T00:00:00.000Z"),
      }),
      makeOrder({
        id: "ord_done_new",
        status: "CANCELLED",
        createdAt: new Date("2026-10-06T00:00:00.000Z"),
      }),
    ]);

    const result = await orderService.list("biz_1", { page: 1, size: 10 });

    expect(mockedDb.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: "biz_1", status: { not: "AWAITING_PAYMENT" } },
      }),
    );
    expect(result.data.map((order) => order.id)).toEqual([
      "ord_active_old",
      "ord_active_new",
      "ord_done_new",
      "ord_done_old",
    ]);
    expect(result.total).toBe(4);
  });

  it("filters by status and pages with a count", async () => {
    mockedDb.order.count.mockResolvedValue(3);
    mockedDb.order.findMany.mockResolvedValue([makeOrder({ status: "READY" })]);

    const result = await orderService.list("biz_1", {
      status: "READY",
      page: 2,
      size: 1,
    });

    expect(mockedDb.order.count).toHaveBeenCalledWith({
      where: { businessId: "biz_1", status: "READY" },
    });
    expect(mockedDb.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 1,
        take: 1,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
    expect(result.total).toBe(3);
  });

  it("reads completed orders newest first", async () => {
    mockedDb.order.findMany.mockResolvedValue([]);

    await orderService.list("biz_1", {
      status: "COMPLETED",
      page: 1,
      size: 10,
    });

    expect(mockedDb.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });
});

describe("orderService.getBySlug", () => {
  it("returns an order the business owns", async () => {
    mockedDb.order.findFirst.mockResolvedValue(makeOrder());

    const order = await orderService.getBySlug("biz_1", "tobi-hair-abc");

    expect(order.id).toBe("ord_1");
    expect(mockedDb.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: "tobi-hair-abc", businessId: "biz_1" },
      }),
    );
  });

  it("returns 404 for another business's order", async () => {
    mockedDb.order.findFirst.mockResolvedValue(null);

    await expect(
      orderService.getBySlug("biz_1", "someone-else"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("orderService.setStatus", () => {
  it.each([
    ["NEW", "READY"],
    ["NEW", "COMPLETED"],
    ["READY", "COMPLETED"],
    ["NEW", "CANCELLED"],
    ["READY", "CANCELLED"],
  ] as const)("allows %s → %s", async (from, to) => {
    mockedDb.order.findFirst.mockResolvedValue(makeOrder({ status: from }));
    mockedDb.order.update.mockImplementation(async ({ data }: any) => ({
      ...makeOrder({ status: from }),
      ...data,
    }));

    const result = await orderService.setStatus(
      "biz_1",
      "tobi-hair-abc",
      to as OrderStatusChange,
    );

    expect(result.status).toBe(to);
    expect(mockedDb.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ord_1" },
        data: expect.objectContaining({ status: to }),
      }),
    );
  });

  it.each([
    ["COMPLETED", "READY"],
    ["CANCELLED", "READY"],
    ["AWAITING_PAYMENT", "READY"],
  ] as const)("refuses %s → %s", async (from, to) => {
    mockedDb.order.findFirst.mockResolvedValue(makeOrder({ status: from }));

    await expect(
      orderService.setStatus(
        "biz_1",
        "tobi-hair-abc",
        to as OrderStatusChange,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockedDb.order.update).not.toHaveBeenCalled();
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
    expect(mockedEmail.sendOrderEmail).not.toHaveBeenCalled();
  });

  it("sets readyAt, completedAt and cancelledAt as the order moves", async () => {
    mockedDb.order.findFirst.mockResolvedValue(makeOrder());

    await orderService.setStatus("biz_1", "tobi-hair-abc", "READY");
    expect(mockedDb.order.update.mock.calls[0][0].data).toMatchObject({
      status: "READY",
      readyAt: expect.any(Date),
    });

    mockedDb.order.findFirst.mockResolvedValue(makeOrder({ status: "READY" }));
    await orderService.setStatus("biz_1", "tobi-hair-abc", "COMPLETED");
    expect(mockedDb.order.update.mock.calls[1][0].data).toMatchObject({
      status: "COMPLETED",
      completedAt: expect.any(Date),
    });

    mockedDb.order.findFirst.mockResolvedValue(makeOrder());
    await orderService.setStatus("biz_1", "tobi-hair-abc", "CANCELLED");
    expect(mockedDb.order.update.mock.calls[2][0].data).toMatchObject({
      status: "CANCELLED",
      cancelledAt: expect.any(Date),
    });
  });

  it("puts stock back when an order is cancelled", async () => {
    mockedDb.order.findFirst.mockResolvedValue(makeOrder({ status: "READY" }));

    await orderService.setStatus("biz_1", "tobi-hair-abc", "CANCELLED");

    expect(mockedDb.productOption.update).toHaveBeenCalledTimes(1);
    expect(mockedDb.productOption.update).toHaveBeenCalledWith({
      where: { id: "opt_1" },
      data: { stock: { increment: 2 } },
    });
  });

  it("only returns stock once, because a cancelled order can't be cancelled again", async () => {
    mockedDb.order.findFirst.mockResolvedValue(
      makeOrder({ status: "CANCELLED" }),
    );

    await expect(
      orderService.setStatus("biz_1", "tobi-hair-abc", "CANCELLED"),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockedDb.productOption.update).not.toHaveBeenCalled();
  });

  it.each([
    ["READY", "ready"],
    ["COMPLETED", "completed"],
    ["CANCELLED", "cancelled"],
  ] as const)("emails the customer when the order is %s", async (to, kind) => {
    mockedDb.order.findFirst.mockResolvedValue(makeOrder());

    await orderService.setStatus(
      "biz_1",
      "tobi-hair-abc",
      to as OrderStatusChange,
    );

    expect(mockedEmail.sendOrderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        kind,
        to: "tolu@example.com",
        orderNumber: "ORD-1022",
        lines: [
          { name: 'Frontal wig — 20"', quantity: 2, total: 90000 },
        ],
        total: 93000,
        currency: "NGN",
        fulfilment: "DELIVERY",
        deliveryAddress: "12 Admiralty Way",
        pickupAddress: "1 Allen Avenue",
        receiptUrl: expect.stringContaining("/receipts/rcp_pub"),
        orderUrl: expect.stringContaining("/orders/ord_pub"),
      }),
    );
  });

  it("sends no email when the customer left no address", async () => {
    mockedDb.order.findFirst.mockResolvedValue(
      makeOrder({ clientEmail: null }),
    );

    await orderService.setStatus("biz_1", "tobi-hair-abc", "READY");

    expect(mockedEmail.sendOrderEmail).not.toHaveBeenCalled();
  });
});

describe("orderService.setFulfilment", () => {
  it("switches to delivery at the business's fee and charges it", async () => {
    mockedDb.order.findFirst.mockResolvedValue(
      makeOrder({
        fulfilment: "PICKUP",
        deliveryAddress: null,
        deliveryFee: 0,
        total: 90000,
      }),
    );

    await orderService.setFulfilment("biz_1", "tobi-hair-abc", {
      fulfilment: "DELIVERY",
      deliveryAddress: "  4 Ozumba Mbadiwe Avenue  ",
    });

    expect(mockedDb.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ord_1" },
        data: {
          fulfilment: "DELIVERY",
          deliveryAddress: "4 Ozumba Mbadiwe Avenue",
          deliveryFee: 3000,
          total: 93000,
        },
      }),
    );
  });

  it("clears the address and the fee on pickup", async () => {
    mockedDb.order.findFirst.mockResolvedValue(
      makeOrder({ deliveryAddress: "12 Admiralty Way" }),
    );

    await orderService.setFulfilment("biz_1", "tobi-hair-abc", {
      fulfilment: "PICKUP",
      deliveryAddress: "ignored",
    });

    expect(mockedDb.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          fulfilment: "PICKUP",
          deliveryAddress: null,
          deliveryFee: 0,
          total: 90000,
        },
      }),
    );
  });

  it("refuses delivery without an address", async () => {
    mockedDb.order.findFirst.mockResolvedValue(makeOrder());

    await expect(
      orderService.setFulfilment("biz_1", "tobi-hair-abc", {
        fulfilment: "DELIVERY",
        deliveryAddress: "   ",
      }),
    ).rejects.toThrow("Enter a delivery address");

    expect(mockedDb.order.update).not.toHaveBeenCalled();
  });

  it("does not take stock", async () => {
    mockedDb.order.findFirst.mockResolvedValue(makeOrder());

    await orderService.setFulfilment("biz_1", "tobi-hair-abc", {
      fulfilment: "PICKUP",
    });

    expect(mockedDb.productOption.update).not.toHaveBeenCalled();
  });
});

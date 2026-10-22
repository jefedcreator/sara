/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    product: { findFirst: vi.fn(), findMany: vi.fn() },
    productOption: { findMany: vi.fn() },
    orderLine: { groupBy: vi.fn() },
  },
}));

import { db } from "@/server/db";

import { getProductPage, getProductPageDetail } from "./product-page";

const mockedDb = db as any;

const money = (value: string) => ({ toString: () => value });

const ROW = {
  id: "prd_1",
  businessId: "biz_1",
  slug: "frontal-wig",
  name: "Frontal wig",
  description: "Hand-tied and ready to wear.",
  photos: ["https://res.cloudinary.com/demo/wig.jpg", "https://res.cloudinary.com/demo/wig-2.jpg"],
  price: money("45000"),
  tracksStock: true,
  options: [
    { id: "opt_20", name: '20"', price: money("45000") },
    { id: "opt_22", name: '22"', price: null },
    { id: "opt_24", name: '24"', price: money("52000") },
  ],
  business: {
    name: "Tobi Hair",
    currency: "NGN",
    paystackSubaccountCode: "ACCT_123",
    offersDelivery: true,
    deliveryFee: money("3000"),
    offersPickup: true,
    address: "12 Admiralty Way",
    city: "Lekki",
    state: " Lagos ",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.product.findFirst.mockResolvedValue(ROW);
  mockedDb.product.findMany.mockResolvedValue([
    {
      slug: "closure",
      name: "HD closure",
      price: money("18000"),
      photos: ["https://res.cloudinary.com/demo/closure.jpg"],
    },
  ]);
  mockedDb.productOption.findMany.mockResolvedValue([
    { id: "opt_20", stock: 5, product: { tracksStock: true } },
    { id: "opt_22", stock: 2, product: { tracksStock: true } },
    { id: "opt_24", stock: 0, product: { tracksStock: true } },
  ]);
  mockedDb.orderLine.groupBy.mockResolvedValue([
    { productOptionId: "opt_20", _sum: { quantity: 2 } },
    { productOptionId: "opt_22", _sum: { quantity: 1 } },
  ]);
});

describe("getProductPage", () => {
  it("maps a live product and subtracts the stock live checkouts hold per option", async () => {
    const page = await getProductPage("frontal-wig");

    expect(mockedDb.product.findFirst.mock.calls[0][0].where).toEqual({
      slug: "frontal-wig",
      isActive: true,
    });
    expect(
      mockedDb.product.findFirst.mock.calls[0][0].select.options.where,
    ).toEqual({ isActive: true });
    expect(page).toEqual({
      slug: "frontal-wig",
      name: "Frontal wig",
      description: "Hand-tied and ready to wear.",
      photos: [
        "https://res.cloudinary.com/demo/wig.jpg",
        "https://res.cloudinary.com/demo/wig-2.jpg",
      ],
      price: "45000",
      currency: "NGN",
      businessName: "Tobi Hair",
      area: "Lekki, Lagos",
      canBuy: true,
      offersDelivery: true,
      deliveryFee: "3000",
      offersPickup: true,
      pickupAddress: "12 Admiralty Way, Lekki, Lagos",
      options: [
        { id: "opt_20", name: '20"', price: "45000", available: 3 },
        { id: "opt_22", name: '22"', price: "45000", available: 1 },
        { id: "opt_24", name: '24"', price: "52000", available: 0 },
      ],
    });
  });

  it("holds stock only for unexpired online checkouts", async () => {
    await getProductPage("frontal-wig");

    const groupBy = mockedDb.orderLine.groupBy.mock.calls[0][0];
    expect(groupBy.by).toEqual(["productOptionId"]);
    expect(groupBy.where.productOptionId).toEqual({
      in: ["opt_20", "opt_22", "opt_24"],
    });
    expect(groupBy.where.order.status).toBe("AWAITING_PAYMENT");
    expect(groupBy.where.order.holdExpiresAt.gt).toBeInstanceOf(Date);
  });

  it("lists up to six other live products, newest first", async () => {
    const detail = await getProductPageDetail("frontal-wig");

    expect(mockedDb.product.findMany.mock.calls[0][0]).toMatchObject({
      where: { businessId: "biz_1", isActive: true, id: { not: "prd_1" } },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
    expect(detail?.others).toEqual([
      {
        slug: "closure",
        name: "HD closure",
        price: "18000",
        photo: "https://res.cloudinary.com/demo/closure.jpg",
      },
    ]);
  });

  it("returns null for an unknown or paused product without reading stock or siblings", async () => {
    mockedDb.product.findFirst.mockResolvedValue(null);

    expect(await getProductPage("gone")).toBeNull();
    expect(await getProductPageDetail("gone")).toBeNull();
    expect(mockedDb.productOption.findMany).not.toHaveBeenCalled();
    expect(mockedDb.orderLine.groupBy).not.toHaveBeenCalled();
    expect(mockedDb.product.findMany).not.toHaveBeenCalled();
  });

  it("leaves made-to-order options uncapped", async () => {
    mockedDb.product.findFirst.mockResolvedValue({
      ...ROW,
      tracksStock: false,
    });
    mockedDb.productOption.findMany.mockResolvedValue(
      ROW.options.map((option) => ({
        id: option.id,
        stock: 0,
        product: { tracksStock: false },
      })),
    );

    const page = await getProductPage("frontal-wig");
    expect(page?.options.map((option) => option.available)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("can't sell online without payment or without a way to get the order", async () => {
    mockedDb.product.findFirst.mockResolvedValue({
      ...ROW,
      business: { ...ROW.business, paystackSubaccountCode: null },
    });
    expect((await getProductPage("frontal-wig"))?.canBuy).toBe(false);

    mockedDb.product.findFirst.mockResolvedValue({
      ...ROW,
      business: {
        ...ROW.business,
        offersDelivery: false,
        offersPickup: false,
        deliveryFee: null,
      },
    });
    const page = await getProductPage("frontal-wig");
    expect(page?.canBuy).toBe(false);
    expect(page?.deliveryFee).toBeNull();
  });

  it("has no area or pickup address when the business left them blank", async () => {
    mockedDb.product.findFirst.mockResolvedValue({
      ...ROW,
      business: {
        ...ROW.business,
        address: null,
        city: " ",
        state: null,
      },
    });

    const page = await getProductPage("frontal-wig");
    expect(page?.area).toBeNull();
    expect(page?.pickupAddress).toBeNull();
  });
});

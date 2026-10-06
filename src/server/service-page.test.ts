/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: { service: { findFirst: vi.fn(), findMany: vi.fn() } },
}));

import { db } from "@/server/db";

import { getServicePage } from "./service-page";

const mockedDb = db as any;

const ROW = {
  id: "svc_1",
  businessId: "biz_1",
  slug: "acme-knotless-braids",
  name: "Knotless braids",
  description: "Waist length, any colour.",
  image: "https://res.cloudinary.com/demo/braids.jpg",
  price: 25000,
  duration: 240,
  bookingMode: "SLOT",
  checkInTime: null,
  checkOutTime: null,
  minUnits: 1,
  maxUnits: 30,
  business: { name: "Acme Salon", currency: "NGN" },
};

beforeEach(() => vi.clearAllMocks());

describe("getServicePage", () => {
  it("reads a live service and up to six of the business's other live services", async () => {
    mockedDb.service.findFirst.mockResolvedValue(ROW);
    mockedDb.service.findMany.mockResolvedValue([
      { slug: "acme-cornrows", name: "Cornrows", image: null, price: 12000, duration: 120, bookingMode: "SLOT" },
    ]);

    const page = await getServicePage("acme-knotless-braids");

    expect(mockedDb.service.findFirst.mock.calls[0][0].where).toEqual({
      slug: "acme-knotless-braids",
      isActive: true,
    });
    expect(mockedDb.service.findMany.mock.calls[0][0]).toMatchObject({
      where: { businessId: "biz_1", isActive: true, id: { not: "svc_1" } },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
    expect(page).toEqual({
      slug: "acme-knotless-braids",
      name: "Knotless braids",
      image: "https://res.cloudinary.com/demo/braids.jpg",
      price: "25000",
      duration: 240,
      bookingMode: "SLOT",
      description: "Waist length, any colour.",
      currency: "NGN",
      checkInTime: null,
      checkOutTime: null,
      minUnits: 1,
      maxUnits: 30,
      businessName: "Acme Salon",
      others: [
        { slug: "acme-cornrows", name: "Cornrows", image: null, price: "12000", duration: 120, bookingMode: "SLOT" },
      ],
    });
  });

  it("returns null for an unknown or paused service without reading others", async () => {
    mockedDb.service.findFirst.mockResolvedValue(null);
    expect(await getServicePage("nope")).toBeNull();
    expect(mockedDb.service.findMany).not.toHaveBeenCalled();
  });

  it("reads only the business's name and currency", async () => {
    mockedDb.service.findFirst.mockResolvedValue(null);
    await getServicePage("x");
    expect(mockedDb.service.findFirst.mock.calls[0][0].select.business).toEqual({
      select: { name: true, currency: true },
    });
  });
});

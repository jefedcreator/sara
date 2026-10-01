import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    service: { findUnique: vi.fn(), findFirst: vi.fn() },
    booking: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
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

import { paystackService } from "@/backend/services/paystack";
import { db } from "@/server/db";
import { BadRequestException, ConflictException } from "@/utils/exceptions";
import { addDays, todayIso } from "@/utils/format";
import { bookingService } from "./index";

const mockedDb = db as any;
const SERVICE = {
  id: "svc_1", name: "Haircut", duration: 60, isActive: true, price: 5000,
  businessId: "biz_1",
  bookingMode: "SLOT", checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 30,
  business: { id: "biz_1", ownerId: "user_1", name: "Acme", paystackSubaccountCode: "ACCT_1", currency: "NGN" },
};
const START = new Date(Date.now() + 24 * 60 * 60 * 1000);
const END = new Date(START.getTime() + 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.service.findUnique.mockResolvedValue(SERVICE);
  mockedDb.service.findFirst.mockResolvedValue(SERVICE);
  mockedDb.booking.findFirst.mockResolvedValue(null);
  mockedDb.booking.findUnique.mockResolvedValue(null);
  mockedDb.booking.create.mockResolvedValue({
    id: "bkg_1", slug: "haircut-ada-1", businessId: "biz_1", serviceId: "svc_1",
    startTime: START, endTime: END, status: "PENDING",
  });
});

describe("bookingService.createWithPayment", () => {
  it("creates a PENDING booking and returns a payment url", async () => {
    const result = await bookingService.createWithPayment({
      serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada",
    });
    expect(result.paymentUrl).toBe("https://paystack.test/pay");
    expect(result.paymentReference).toBe("ref_123");
    expect(paystackService.initializeTransaction).toHaveBeenCalled();
  });

  it("rejects an overlapping slot", async () => {
    mockedDb.booking.findFirst.mockResolvedValue({ id: "existing" });
    await expect(
      bookingService.createWithPayment({
        serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(paystackService.initializeTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the business has no Paystack subaccount", async () => {
    mockedDb.service.findFirst.mockResolvedValue({
      ...SERVICE, business: { ...SERVICE.business, paystackSubaccountCode: null },
    });
    await expect(
      bookingService.createWithPayment({
        serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("stores units, amount and a 30-minute hold", async () => {
    const before = Date.now();
    await bookingService.createWithPayment({ serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada" });
    const data = mockedDb.booking.create.mock.calls[0][0].data;
    expect(data.units).toBe(1);
    expect(data.amount.toString()).toBe("5000");
    expect(data.holdExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
  });

  it("charges price × nights for a stay and works out check-out itself", async () => {
    mockedDb.service.findFirst.mockResolvedValue({
      ...SERVICE, name: "Lekki 2-bed 4B", bookingMode: "NIGHTLY", price: 85000, duration: 1440,
      checkInTime: "14:00", checkOutTime: "12:00",
    });
    const checkIn = addDays(todayIso(), 3);
    await bookingService.createWithPayment({
      serviceSlug: "lekki-4b", startTime: new Date(`${checkIn}T14:00:00.000Z`), units: 3, clientName: "Bisi",
    });
    const data = mockedDb.booking.create.mock.calls[0][0].data;
    expect(data.endTime).toEqual(new Date(`${addDays(checkIn, 3)}T12:00:00.000Z`));
    expect(data.units).toBe(3);
    expect(data.amount.toString()).toBe("255000");
    expect(paystackService.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 25_500_000, metadata: expect.objectContaining({ units: 3 }) }),
    );
  });

  it("checks a stay against the same apartment only", async () => {
    mockedDb.service.findFirst.mockResolvedValue({
      ...SERVICE, bookingMode: "NIGHTLY", price: 85000, duration: 1440, checkInTime: "14:00", checkOutTime: "12:00",
    });
    const checkIn = addDays(todayIso(), 3);
    await bookingService.createWithPayment({
      serviceSlug: "lekki-4b", startTime: new Date(`${checkIn}T14:00:00.000Z`), units: 2, clientName: "Bisi",
    });
    const where = mockedDb.booking.findFirst.mock.calls[0][0].where;
    expect(where.serviceId).toBe("svc_1");
    expect(where).not.toHaveProperty("businessId");
  });

  it("rejects a slot end time that doesn't match the duration", async () => {
    await expect(
      bookingService.createWithPayment({
        serviceSlug: "haircut", startTime: START, endTime: new Date(START.getTime() + 30 * 60 * 1000), clientName: "Ada",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("retries once on a serialization failure, then reports the time as taken", async () => {
    mockedDb.$transaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2034" });
    await expect(
      bookingService.createWithPayment({ serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockedDb.$transaction).toHaveBeenCalledTimes(2);
    expect(paystackService.initializeTransaction).not.toHaveBeenCalled();
  });
});

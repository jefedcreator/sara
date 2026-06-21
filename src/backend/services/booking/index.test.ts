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
import { BadRequestException } from "@/utils/exceptions";
import { bookingService } from "./index";

const mockedDb = db as any;
const SERVICE = {
  id: "svc_1", name: "Haircut", duration: 60, isActive: true, price: 5000,
  businessId: "biz_1",
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
    ).rejects.toBeInstanceOf(BadRequestException);
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
});

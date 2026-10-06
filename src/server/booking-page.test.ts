import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: { booking: { findUnique: vi.fn() } } }));

import { db } from "@/server/db";

import { getPublicBooking } from "./booking-page";

const mockedDb = db as any;

const ROW = {
  publicId: "Pq8sN1xV0kL3mA6t",
  status: "CONFIRMED",
  startTime: new Date("2026-10-12T14:00:00.000Z"),
  endTime: new Date("2026-10-12T18:00:00.000Z"),
  units: 1,
  holdExpiresAt: null,
  amount: 25000,
  clientName: "Ada Okafor",
  service: { slug: "acme-knotless-braids", name: "Knotless braids", bookingMode: "SLOT" },
  business: {
    name: "Acme Salon",
    currency: "NGN",
    address: "12 Admiralty Way",
    city: "Lekki",
    state: " ",
  },
  payments: [{ receipt: { publicId: "b7T0qLm2Vn9cZ4wE" } }],
};

beforeEach(() => vi.clearAllMocks());

describe("getPublicBooking", () => {
  it("maps the booking for its page", async () => {
    mockedDb.booking.findUnique.mockResolvedValue(ROW);
    expect(await getPublicBooking("Pq8sN1xV0kL3mA6t")).toEqual({
      publicId: "Pq8sN1xV0kL3mA6t",
      status: "CONFIRMED",
      startTime: "2026-10-12T14:00:00.000Z",
      endTime: "2026-10-12T18:00:00.000Z",
      units: 1,
      holdExpiresAt: null,
      amount: 25000,
      currency: "NGN",
      clientName: "Ada Okafor",
      service: { slug: "acme-knotless-braids", name: "Knotless braids", bookingMode: "SLOT" },
      businessName: "Acme Salon",
      businessAddress: "12 Admiralty Way, Lekki",
      receiptPath: "/receipts/b7T0qLm2Vn9cZ4wE",
    });
  });

  it("finds the booking by public id alone, whatever its service's state", async () => {
    mockedDb.booking.findUnique.mockResolvedValue(null);
    await getPublicBooking("Pq8sN1xV0kL3mA6t");
    expect(mockedDb.booking.findUnique.mock.calls[0][0].where).toEqual({
      publicId: "Pq8sN1xV0kL3mA6t",
    });
  });

  it("has no address and no receipt when there are none", async () => {
    mockedDb.booking.findUnique.mockResolvedValue({
      ...ROW,
      business: { ...ROW.business, address: null, city: null, state: null },
      payments: [],
    });
    expect(await getPublicBooking("Pq8sN1xV0kL3mA6t")).toMatchObject({
      businessAddress: null,
      receiptPath: null,
    });
  });

  it("returns null for an unknown id", async () => {
    mockedDb.booking.findUnique.mockResolvedValue(null);
    expect(await getPublicBooking("nope")).toBeNull();
  });

  it("never reads the customer's or the business's contact details", async () => {
    mockedDb.booking.findUnique.mockResolvedValue(null);
    await getPublicBooking("x");
    const { select } = mockedDb.booking.findUnique.mock.calls[0][0];
    expect(select).not.toHaveProperty("clientEmail");
    expect(select).not.toHaveProperty("clientPhone");
    expect(select.business.select).not.toHaveProperty("email");
    expect(select.business.select).not.toHaveProperty("phone");
  });
});

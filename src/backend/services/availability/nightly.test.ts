import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: { service: { findUnique: vi.fn() }, booking: { findMany: vi.fn() } },
}));

import { db } from "@/server/db";
import { BadRequestException } from "@/utils/exceptions";

import { getNights } from "./nightly";

const mockedDb = db as any;
const NOW = new Date("2026-10-01T09:00:00.000Z"); // 10:00 Lagos
const STAY = {
  id: "svc_4b", businessId: "biz_1", bookingMode: "NIGHTLY",
  checkInTime: "14:00", checkOutTime: "12:00",
};
const booked = (from: string, to: string) => ({
  startTime: new Date(`${from}T14:00:00.000Z`),
  endTime: new Date(`${to}T12:00:00.000Z`),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.service.findUnique.mockResolvedValue(STAY);
  mockedDb.booking.findMany.mockResolvedValue([]);
});

describe("getNights", () => {
  it("returns one entry per night in [from, to)", async () => {
    const nights = await getNights({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-10-04", now: NOW });
    expect(nights.map((n) => n.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(nights.every((n) => n.isAvailable)).toBe(true);
  });

  it("marks booked nights and allows check-in on a check-out day", async () => {
    mockedDb.booking.findMany.mockResolvedValue([booked("2026-10-02", "2026-10-04")]);
    const nights = await getNights({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-10-06", now: NOW });
    expect(Object.fromEntries(nights.map((n) => [n.date, n.isAvailable]))).toEqual({
      "2026-10-01": true,
      "2026-10-02": false,
      "2026-10-03": false,
      "2026-10-04": true, // the previous guest leaves at 12:00, the next arrives at 14:00
      "2026-10-05": true,
    });
  });

  it("keeps tonight open after the check-in hour and closes past nights", async () => {
    const evening = new Date("2026-10-01T17:00:00.000Z"); // 18:00 Lagos
    const nights = await getNights({ serviceId: "svc_4b", from: "2026-09-30", to: "2026-10-02", now: evening });
    expect(nights).toEqual([
      { date: "2026-09-30", isAvailable: false },
      { date: "2026-10-01", isAvailable: true },
    ]);
  });

  it("queries only this apartment's bookings", async () => {
    await getNights({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-10-04", now: NOW });
    const where = mockedDb.booking.findMany.mock.calls[0][0].where;
    expect(where.serviceId).toBe("svc_4b");
    expect(where).not.toHaveProperty("businessId");
  });

  it("passes the booking being moved through as excluded", async () => {
    await getNights({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-10-04", excludeBookingId: "bkg_1", now: NOW });
    expect(mockedDb.booking.findMany.mock.calls[0][0].where.id).toEqual({ not: "bkg_1" });
  });

  it("refuses a service that isn't booked by the night", async () => {
    mockedDb.service.findUnique.mockResolvedValue({ ...STAY, bookingMode: "SLOT" });
    await expect(getNights({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-10-04", now: NOW })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

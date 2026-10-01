import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    service: { findUnique: vi.fn() },
    businessHours: { findUnique: vi.fn() },
    businessClosure: { findUnique: vi.fn() },
    booking: { findMany: vi.fn() },
  },
}));

import { db } from "@/server/db";
import { BadRequestException } from "@/utils/exceptions";

import { getPickupTimes } from "./daily";

const mockedDb = db as any;
const NOW = new Date("2026-10-01T09:00:00.000Z"); // 10:00 Lagos
const CAR = {
  id: "svc_car", businessId: "biz_1", bookingMode: "DAILY",
  availableFrom: "08:00", availableTo: "12:00", minUnits: 1, maxUnits: 14,
};
const at = (iso: string) => new Date(iso);

type Hours = { isClosed: boolean; startTime: string; endTime: string } | null;

function setup({
  hours = {} as Record<number, Hours>,
  closures = [] as string[],
  bookings = [] as { startTime: Date; endTime: Date }[],
} = {}) {
  mockedDb.service.findUnique.mockResolvedValue(CAR);
  mockedDb.businessHours.findUnique.mockImplementation(
    async (args: { where: { businessId_dayOfWeek: { dayOfWeek: number } } }) =>
      hours[args.where.businessId_dayOfWeek.dayOfWeek] ?? null,
  );
  mockedDb.businessClosure.findUnique.mockImplementation(
    async (args: { where: { businessId_date: { date: Date } } }) =>
      closures.includes(args.where.businessId_date.date.toISOString().slice(0, 10)) ? { id: "c" } : null,
  );
  mockedDb.booking.findMany.mockResolvedValue(bookings);
}

beforeEach(() => vi.clearAllMocks());

describe("getPickupTimes", () => {
  it("offers whole hours from availableFrom up to availableTo, returning units × 24h later", async () => {
    setup();
    const times = await getPickupTimes({ serviceId: "svc_car", date: "2026-10-05", units: 2, now: NOW });
    expect(times.map((t) => t.startTime.toISOString().slice(11, 16))).toEqual(["08:00", "09:00", "10:00", "11:00"]);
    expect(times[0]!.endTime).toEqual(at("2026-10-07T08:00:00.000Z"));
    expect(times.every((t) => t.isAvailable)).toBe(true);
  });

  it("closes pickups that would return on a day off", async () => {
    setup({ closures: ["2026-10-07"] });
    const times = await getPickupTimes({ serviceId: "svc_car", date: "2026-10-05", units: 2, now: NOW });
    expect(times.every((t) => !t.isAvailable)).toBe(true);
  });

  it("closes pickups whose return falls outside working hours", async () => {
    // 2026-10-07 is a Wednesday (3): open 10:00–18:00, so 08:00 and 09:00 returns are out.
    setup({ hours: { 3: { isClosed: false, startTime: "10:00", endTime: "18:00" } } });
    const times = await getPickupTimes({ serviceId: "svc_car", date: "2026-10-05", units: 2, now: NOW });
    expect(times.map((t) => t.isAvailable)).toEqual([false, false, true, true]);
  });

  it("closes pickups that overlap a rental of the same car", async () => {
    setup({ bookings: [{ startTime: at("2026-10-06T09:00:00.000Z"), endTime: at("2026-10-07T09:00:00.000Z") }] });
    const times = await getPickupTimes({ serviceId: "svc_car", date: "2026-10-05", units: 1, now: NOW });
    // 1-day rentals from 08:00 end 08:00 on the 6th (free); from 10:00 end 10:00 on the 6th (overlaps).
    expect(times.map((t) => t.isAvailable)).toEqual([true, true, false, false]);
    expect(mockedDb.booking.findMany.mock.calls[0][0].where.serviceId).toBe("svc_car");
  });

  it("closes pickup times that have passed today", async () => {
    setup();
    const times = await getPickupTimes({ serviceId: "svc_car", date: "2026-10-01", units: 1, now: NOW });
    expect(times.map((t) => t.isAvailable)).toEqual([false, false, true, true]); // 10:00 Lagos now
  });

  it("refuses units outside the car's limits", async () => {
    setup();
    await expect(getPickupTimes({ serviceId: "svc_car", date: "2026-10-05", units: 15, now: NOW })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

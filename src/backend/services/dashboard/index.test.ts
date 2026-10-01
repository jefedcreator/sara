import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: { booking: { findMany: vi.fn() } } }));

import { db } from "@/server/db";

import { dashboardService } from "./index";

const mockedDb = db as any;

function today(time: string) {
  const d = new Date();
  const [h, m] = time.split(":").map(Number);
  d.setHours(h!, m!, 0, 0);
  return d;
}
const daysFromNow = (n: number, time: string) => {
  const d = today(time);
  d.setDate(d.getDate() + n);
  return d;
};

beforeEach(() => vi.clearAllMocks());

describe("dashboardService.todayBookings", () => {
  it("lists check-outs, check-ins, pickups and slots in time order", async () => {
    mockedDb.booking.findMany.mockResolvedValue([
      { slug: "stay-in", startTime: today("14:00"), endTime: daysFromNow(3, "12:00"), units: 3, status: "CONFIRMED", clientName: "Bisi Ojo", service: { name: "Lekki 4B", bookingMode: "NIGHTLY" } },
      { slug: "stay-out", startTime: daysFromNow(-2, "14:00"), endTime: today("12:00"), units: 2, status: "CONFIRMED", clientName: "Ada Okafor", service: { name: "Lekki 4B", bookingMode: "NIGHTLY" } },
      { slug: "car", startTime: today("10:00"), endTime: daysFromNow(2, "10:00"), units: 2, status: "CONFIRMED", clientName: "Chidi Eze", service: { name: "Toyota Prado", bookingMode: "DAILY" } },
      { slug: "braids", startTime: today("13:00"), endTime: today("17:00"), units: 1, status: "PENDING", clientName: "Funke Bello", service: { name: "Knotless braids", bookingMode: "SLOT" } },
    ]);

    const events = await dashboardService.todayBookings("biz_1");

    expect(events.map((e) => [e.slug, e.kind])).toEqual([
      ["car", "PICKUP"],
      ["stay-out", "CHECK_OUT"],
      ["braids", "SLOT"],
      ["stay-in", "CHECK_IN"],
    ]);
  });

  it("asks for bookings starting today, or stays and rentals ending today, that still hold time", async () => {
    mockedDb.booking.findMany.mockResolvedValue([]);
    await dashboardService.todayBookings("biz_1");
    const where = mockedDb.booking.findMany.mock.calls[0][0].where;
    expect(where.businessId).toBe("biz_1");
    expect(where.AND).toHaveLength(2);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    booking: { findMany: vi.fn() },
    orderLine: { findMany: vi.fn() },
    order: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
  },
}));

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

describe("dashboardService.revenueByItem", () => {
  it("merges service and product revenue, highest first", async () => {
    mockedDb.booking.findMany.mockResolvedValue([
      { serviceId: "s1", service: { name: "Knotless braids", slug: "kb", price: 25000 } },
      { serviceId: "s1", service: { name: "Knotless braids", slug: "kb", price: 25000 } },
    ]);
    mockedDb.orderLine.findMany.mockResolvedValue([
      { quantity: 2, total: 90000, productOption: { product: { id: "p1", name: "Frontal wig", slug: "frontal-wig" } } },
      { quantity: 1, total: 48000, productOption: { product: { id: "p1", name: "Frontal wig", slug: "frontal-wig" } } },
      { quantity: 3, total: 9000, productOption: { product: { id: "p2", name: "Edge control", slug: "edge-control" } } },
      { quantity: 1, total: 1000, productOption: null },
    ]);

    const rows = await dashboardService.revenueByItem("biz_1");

    expect(rows).toEqual([
      { kind: "PRODUCT", id: "p1", name: "Frontal wig", slug: "frontal-wig", totalRevenue: 138000, count: 3 },
      { kind: "SERVICE", id: "s1", name: "Knotless braids", slug: "kb", totalRevenue: 50000, count: 2 },
      { kind: "PRODUCT", id: "p2", name: "Edge control", slug: "edge-control", totalRevenue: 9000, count: 3 },
    ]);
    const where = mockedDb.orderLine.findMany.mock.calls[0][0].where;
    expect(where.order).toEqual({ businessId: "biz_1", status: { in: ["NEW", "READY", "COMPLETED"] } });
  });
});

describe("dashboardService.runningLow", () => {
  const product = (options: { name: string; stock: number }[]) => ({ slug: "frontal-wig", name: "Frontal wig", options });

  it("includes options with exactly 3 left and leaves out 4", async () => {
    mockedDb.product.findMany.mockResolvedValue([
      product([
        { name: '18"', stock: 4 },
        { name: '20"', stock: 3 },
        { name: '22"', stock: 0 },
      ]),
    ]);

    const low = await dashboardService.runningLow("biz_1");

    expect(low).toEqual([
      { productSlug: "frontal-wig", label: 'Frontal wig — 22"', stock: 0 },
      { productSlug: "frontal-wig", label: 'Frontal wig — 20"', stock: 3 },
    ]);
  });

  it("leaves untracked and paused products out of running low", async () => {
    mockedDb.product.findMany.mockResolvedValue([]);
    await dashboardService.runningLow("biz_1");
    const args = mockedDb.product.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ businessId: "biz_1", isActive: true, tracksStock: true });
    expect(args.select.options.where).toEqual({ isActive: true });
  });

  it("uses the product name alone for an option with no name", async () => {
    mockedDb.product.findMany.mockResolvedValue([product([{ name: "", stock: 2 }])]);
    const low = await dashboardService.runningLow("biz_1");
    expect(low[0]!.label).toBe("Frontal wig");
  });
});

describe("dashboardService.ordersToSendOut", () => {
  it("lists New and Ready orders oldest first, at most 10", async () => {
    mockedDb.order.findMany.mockResolvedValue([
      { slug: "o-1", orderNumber: "ORD-1001", clientName: "Tolu Adeyemi", status: "NEW", fulfilment: "DELIVERY", total: 45000 },
    ]);

    const orders = await dashboardService.ordersToSendOut("biz_1");

    const args = mockedDb.order.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ businessId: "biz_1", status: { in: ["NEW", "READY"] } });
    expect(args.orderBy).toEqual({ createdAt: "asc" });
    expect(args.take).toBe(10);
    expect(orders).toEqual([
      { slug: "o-1", orderNumber: "ORD-1001", clientName: "Tolu Adeyemi", status: "NEW", fulfilment: "DELIVERY", total: 45000 },
    ]);
  });
});

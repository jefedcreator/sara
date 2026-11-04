import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    booking: { findMany: vi.fn() },
    orderLine: { findMany: vi.fn() },
    order: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    invoice: { findMany: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn(), count: vi.fn() },
    payment: { aggregate: vi.fn() },
  },
}));

import { db } from "@/server/db";

import { dashboardService } from "./index";

const mockedDb = db as any;

function today(time: string) {
  return new Date(`2026-11-04T${time}:00+01:00`);
}
const daysFromNow = (n: number, time: string) => {
  const d = today(time);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T12:00:00+01:00"));
});
afterEach(() => vi.useRealTimers());

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
    expect(where.service).toEqual({ businessId: "biz_1" });
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0].OR[1]).toEqual({ status: "PENDING", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: new Date() } }] });
  });
});

describe("dashboardService.revenueByItem", () => {
  it("uses the same half-open period for booking and order creation", async () => {
    mockedDb.booking.findMany.mockResolvedValue([]);
    mockedDb.orderLine.findMany.mockResolvedValue([]);
    const range = { from: today("00:00"), to: daysFromNow(1, "00:00") };
    await dashboardService.revenueByItem("biz_1", range);
    expect(mockedDb.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: "biz_1", service: { businessId: "biz_1" }, status: "CONFIRMED", createdAt: { gte: range.from, lt: range.to } },
    }));
    expect(mockedDb.orderLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ order: {
        businessId: "biz_1", status: { in: ["NEW", "READY", "COMPLETED"] }, createdAt: { gte: range.from, lt: range.to },
      } }),
    }));
  });

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
    expect(where.productOption).toEqual({ product: { businessId: "biz_1" } });
  });
});

describe("dashboardService shared reads", () => {
  it("filters unpaid invoices by owned business, customer and half-open due period", async () => {
    mockedDb.invoice.findMany.mockResolvedValue([{
      slug: "inv-1", invoiceNumber: "INV-1042", clientName: "Ada", total: "50000.50", amountPaid: "10000.25", currency: "NGN", url: null,
    }]);
    const filters = { customerId: "cus_1", from: today("00:00"), to: daysFromNow(1, "00:00") };
    expect(await dashboardService.unpaidInvoices("biz_1", 5, filters)).toEqual([{
      slug: "inv-1", invoiceNumber: "INV-1042", clientName: "Ada", outstanding: 40000.25, currency: "NGN", url: null,
    }]);
    expect(mockedDb.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: "biz_1", status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, customerId: "cus_1", dueAt: { gte: filters.from, lt: filters.to } },
      take: 5,
    }));
  });

  it("aggregates all unpaid matches separately by currency without a list cap", async () => {
    mockedDb.invoice.groupBy.mockResolvedValue([
      { currency: "USD", _count: { _all: 4 }, _sum: { total: "1000", amountPaid: "100" } },
      { currency: "NGN", _count: { _all: 21 }, _sum: { total: "500000", amountPaid: "50000" } },
    ]);
    const filters = { customerId: "cus_1", from: today("00:00"), to: daysFromNow(1, "00:00") };
    expect(await dashboardService.unpaidInvoiceSummary("biz_1", filters)).toEqual({
      count: 25, outstanding: 450900, byCurrency: [
        { currency: "NGN", count: 21, outstanding: 450000 },
        { currency: "USD", count: 4, outstanding: 900 },
      ],
    });
    const args = mockedDb.invoice.groupBy.mock.calls[0][0];
    expect(args.where).toEqual({ businessId: "biz_1", status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, customerId: "cus_1", dueAt: { gte: filters.from, lt: filters.to } });
    expect(args).not.toHaveProperty("take");
  });

  it("uses Lagos midnight even when the UTC day has not changed", async () => {
    vi.setSystemTime(new Date("2026-11-03T23:30:00Z"));
    mockedDb.booking.findMany.mockResolvedValue([]);
    await dashboardService.todayBookings("biz_1");
    expect(mockedDb.booking.findMany.mock.calls[0][0].where.AND[1].OR[0]).toEqual({
      startTime: { gte: new Date("2026-11-03T23:00:00Z"), lt: new Date("2026-11-04T23:00:00Z") },
    });
  });

  it("includes the start, excludes the end, and retains all events before display caps", async () => {
    const range = { from: today("00:00"), to: daysFromNow(1, "00:00") };
    const base = { units: 1, status: "CONFIRMED", clientName: "Ada", service: { name: "Apartment", bookingMode: "NIGHTLY" } };
    mockedDb.booking.findMany.mockResolvedValue([
      { ...base, slug: "boundary", startTime: range.from, endTime: range.to },
      ...Array.from({ length: 25 }, (_, index) => ({ ...base, slug: `stay-${index}`, startTime: today("10:00"), endTime: today("14:00") })),
    ]);
    const all = await dashboardService.bookingsInRange("biz_1", range);
    expect(all).toHaveLength(51);
    expect(all.filter((event) => event.slug === "boundary").map((event) => event.kind)).toEqual(["CHECK_IN"]);
    expect(mockedDb.booking.findMany.mock.calls[0][0]).not.toHaveProperty("take");
    expect(await dashboardService.todayBookings("biz_1")).toHaveLength(20);
  });

  it("summarises payments inside the range and current unpaid totals independently", async () => {
    const range = { from: today("00:00"), to: daysFromNow(1, "00:00") };
    mockedDb.payment.aggregate.mockResolvedValue({ _sum: { amount: "45000.50" } });
    mockedDb.invoice.count.mockResolvedValue(30);
    mockedDb.invoice.aggregate.mockResolvedValue({ _sum: { total: "900000", amountPaid: "50000" } });
    expect(await dashboardService.summaryForPeriod("biz_1", range)).toEqual({ revenue: 45000.5, unpaidCount: 30, unpaidTotal: 850000 });
    expect(mockedDb.payment.aggregate).toHaveBeenCalledWith({ where: { businessId: "biz_1", createdAt: { gte: range.from, lt: range.to } }, _sum: { amount: true } });
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

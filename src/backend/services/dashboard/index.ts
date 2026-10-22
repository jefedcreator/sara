import type { InvoiceStatus, Prisma } from "@prisma/client";

import type { DashboardData, ItemRevenue } from "types";

import { activeBookingWhere } from "@/backend/services/booking/conflicts";
import { db } from "@/server/db";
import type { TodayEventKind } from "@/utils/format";
import { LOW_STOCK } from "@/utils/stock";

/*
 * The owner's day at a glance. One source for both the chat menu (items 4-6)
 * and the web dashboard, so they always show the same numbers.
 *
 * Day and week boundaries use the server's local midnight (Monday-first
 * week), as the chat always has.
 */

export const UNPAID_STATUSES: InvoiceStatus[] = ["SENT", "PARTIALLY_PAID", "OVERDUE"];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfWeek(): Date {
  const d = startOfToday();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}
function endOfToday(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

export type UnpaidInvoice = {
  slug: string;
  invoiceNumber: string;
  clientName: string;
  outstanding: number;
  currency: string;
  url: string | null;
};

export type TodayBooking = {
  slug: string;
  /** What happens at `at`: a slot, or a stay/rental starting or ending. */
  kind: TodayEventKind;
  at: Date;
  startTime: Date;
  endTime: Date;
  units: number;
  status: "PENDING" | "CONFIRMED";
  clientName: string;
  serviceName: string;
};

const START_KIND = { SLOT: "SLOT", NIGHTLY: "CHECK_IN", DAILY: "PICKUP" } as const;
const END_KIND = { NIGHTLY: "CHECK_OUT", DAILY: "RETURN" } as const;

export type ServiceRevenue = {
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  totalRevenue: number;
  totalBookings: number;
};

export type OrderToSend = DashboardData["ordersToSendOut"][number];
export type RunningLow = DashboardData["runningLow"][number];

/** Orders that have been paid for and not yet handed over. */
const TO_SEND_STATUSES = ["NEW", "READY"] as const;
/** Orders that count as sales. */
const SOLD_STATUSES = ["NEW", "READY", "COMPLETED"] as const;
const ORDERS_TO_SEND_LIMIT = 10;
const RUNNING_LOW_LIMIT = 10;

export type RevenueOverview = {
  services: ServiceRevenue[];
  totalRevenue: number;
  totalBookings: number;
};

export type BusinessSummary = {
  todayRevenue: number;
  weekRevenue: number;
  unpaidCount: number;
};

class DashboardService {
  /** Oldest first: the ones waiting longest lead. */
  async unpaidInvoices(businessId: string, limit = 10): Promise<UnpaidInvoice[]> {
    const invoices = await db.invoice.findMany({
      where: { businessId, status: { in: UNPAID_STATUSES } },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: {
        slug: true,
        invoiceNumber: true,
        clientName: true,
        total: true,
        amountPaid: true,
        currency: true,
        url: true,
      },
    });
    return invoices.map((inv) => ({
      slug: inv.slug,
      invoiceNumber: inv.invoiceNumber,
      clientName: inv.clientName,
      outstanding: Number(inv.total) - Number(inv.amountPaid),
      currency: inv.currency,
      url: inv.url ?? null,
    }));
  }

  /**
   * Today's moments, in time order: slot bookings, and stays and rentals
   * that start (check-in, pickup) or end (check-out, return) today.
   */
  async todayBookings(businessId: string): Promise<TodayBooking[]> {
    const start = startOfToday();
    const end = endOfToday();
    const bookings = await db.booking.findMany({
      where: {
        businessId,
        AND: [
          activeBookingWhere(),
          {
            OR: [
              { startTime: { gte: start, lt: end } },
              { endTime: { gte: start, lt: end }, service: { bookingMode: { not: "SLOT" } } },
            ],
          },
        ],
      },
      orderBy: { startTime: "asc" },
      take: 40,
      select: {
        slug: true, startTime: true, endTime: true, units: true, status: true, clientName: true,
        service: { select: { name: true, bookingMode: true } },
      },
    });

    const events: TodayBooking[] = [];
    for (const b of bookings) {
      const base = {
        slug: b.slug,
        startTime: b.startTime,
        endTime: b.endTime,
        units: b.units,
        status: b.status as TodayBooking["status"],
        clientName: b.clientName,
        serviceName: b.service.name,
      };
      const mode = b.service.bookingMode;
      if (b.startTime >= start && b.startTime < end) events.push({ ...base, kind: START_KIND[mode], at: b.startTime });
      if (mode !== "SLOT" && b.endTime >= start && b.endTime < end) events.push({ ...base, kind: END_KIND[mode], at: b.endTime });
    }
    return events.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 20);
  }

  /** Payments received today and this week, and how many invoices are unpaid. */
  async summary(businessId: string): Promise<BusinessSummary> {
    const [todayAgg, weekAgg, unpaidCount] = await Promise.all([
      db.payment.aggregate({
        where: { businessId, createdAt: { gte: startOfToday() } },
        _sum: { amount: true },
      }),
      db.payment.aggregate({
        where: { businessId, createdAt: { gte: startOfWeek() } },
        _sum: { amount: true },
      }),
      db.invoice.count({ where: { businessId, status: { in: UNPAID_STATUSES } } }),
    ]);
    return {
      todayRevenue: Number(todayAgg._sum.amount ?? 0),
      weekRevenue: Number(weekAgg._sum.amount ?? 0),
      unpaidCount,
    };
  }

  /** Everything still owed across unpaid invoices. */
  async unpaidTotal(businessId: string): Promise<number> {
    const agg = await db.invoice.aggregate({
      where: { businessId, status: { in: UNPAID_STATUSES } },
      _sum: { total: true, amountPaid: true },
    });
    return Number(agg._sum.total ?? 0) - Number(agg._sum.amountPaid ?? 0);
  }

  /**
   * Revenue per service from confirmed bookings (priced at the service's
   * current price), highest first. Dates are YYYY-MM-DD, inclusive, on the
   * booking's creation date.
   */
  async revenueByService(
    businessId: string,
    filter: { serviceId?: string; from?: string; to?: string } = {},
  ): Promise<RevenueOverview> {
    const where: Prisma.BookingWhereInput = { businessId, status: "CONFIRMED" };
    if (filter.serviceId) where.serviceId = filter.serviceId;
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from && { gte: new Date(`${filter.from}T00:00:00.000Z`) }),
        ...(filter.to && { lte: new Date(`${filter.to}T23:59:59.999Z`) }),
      };
    }

    const bookings = await db.booking.findMany({
      where,
      select: {
        serviceId: true,
        service: { select: { name: true, slug: true, price: true } },
      },
    });

    const byService = new Map<string, ServiceRevenue>();
    for (const booking of bookings) {
      const price = Number(booking.service.price);
      const row = byService.get(booking.serviceId) ?? {
        serviceId: booking.serviceId,
        serviceName: booking.service.name,
        serviceSlug: booking.service.slug,
        totalRevenue: 0,
        totalBookings: 0,
      };
      row.totalRevenue += price;
      row.totalBookings += 1;
      byService.set(booking.serviceId, row);
    }

    const services = [...byService.values()]
      .map((row) => ({ ...row, totalRevenue: Math.round(row.totalRevenue * 100) / 100 }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
    const totalRevenue = services.reduce((sum, row) => sum + row.totalRevenue, 0);
    const totalBookings = services.reduce((sum, row) => sum + row.totalBookings, 0);

    return {
      services,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalBookings,
    };
  }

  /**
   * Services and products together, highest earner first. Services earn from
   * confirmed bookings at the service's current price; products from the
   * lines of New, Ready and Completed orders (count is units sold).
   */
  async revenueByItem(businessId: string): Promise<ItemRevenue[]> {
    const [bookings, lines] = await Promise.all([
      db.booking.findMany({
        where: { businessId, status: "CONFIRMED" },
        select: {
          serviceId: true,
          service: { select: { name: true, slug: true, price: true } },
        },
      }),
      db.orderLine.findMany({
        where: {
          order: { businessId, status: { in: [...SOLD_STATUSES] } },
          productOptionId: { not: null },
        },
        select: {
          quantity: true,
          total: true,
          productOption: {
            select: { product: { select: { id: true, name: true, slug: true } } },
          },
        },
      }),
    ]);

    const rows = new Map<string, ItemRevenue>();
    for (const booking of bookings) {
      const key = `SERVICE:${booking.serviceId}`;
      const row = rows.get(key) ?? {
        kind: "SERVICE" as const,
        id: booking.serviceId,
        name: booking.service.name,
        slug: booking.service.slug,
        totalRevenue: 0,
        count: 0,
      };
      row.totalRevenue += Number(booking.service.price);
      row.count += 1;
      rows.set(key, row);
    }
    for (const line of lines) {
      const product = line.productOption?.product;
      if (!product) continue;
      const key = `PRODUCT:${product.id}`;
      const row = rows.get(key) ?? {
        kind: "PRODUCT" as const,
        id: product.id,
        name: product.name,
        slug: product.slug,
        totalRevenue: 0,
        count: 0,
      };
      row.totalRevenue += Number(line.total);
      row.count += line.quantity;
      rows.set(key, row);
    }

    return [...rows.values()]
      .map((row) => ({ ...row, totalRevenue: Math.round(row.totalRevenue * 100) / 100 }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
  }

  /** Paid orders still to hand over (New and Ready), oldest first. */
  async ordersToSendOut(businessId: string): Promise<OrderToSend[]> {
    const orders = await db.order.findMany({
      where: { businessId, status: { in: [...TO_SEND_STATUSES] } },
      orderBy: { createdAt: "asc" },
      take: ORDERS_TO_SEND_LIMIT,
      select: {
        slug: true,
        orderNumber: true,
        clientName: true,
        status: true,
        fulfilment: true,
        total: true,
      },
    });
    return orders.map((order) => ({
      slug: order.slug,
      orderNumber: order.orderNumber ?? order.slug,
      clientName: order.clientName,
      status: order.status as OrderToSend["status"],
      fulfilment: order.fulfilment,
      total: Number(order.total),
    }));
  }

  /**
   * Options of live, stock-tracked products with three or fewer left, fewest
   * first. Untracked ("made to order") and paused products never run low.
   */
  async runningLow(businessId: string): Promise<RunningLow[]> {
    const products = await db.product.findMany({
      where: { businessId, isActive: true, tracksStock: true },
      select: {
        slug: true,
        name: true,
        options: {
          where: { isActive: true },
          orderBy: { position: "asc" },
          select: { name: true, stock: true },
        },
      },
    });

    const low: RunningLow[] = [];
    for (const product of products) {
      for (const option of product.options) {
        if (option.stock > LOW_STOCK) continue;
        low.push({
          productSlug: product.slug,
          label: option.name ? `${product.name} — ${option.name}` : product.name,
          stock: option.stock,
        });
      }
    }
    return low.sort((a, b) => a.stock - b.stock).slice(0, RUNNING_LOW_LIMIT);
  }

  /** Everything the dashboard shows, in one call, JSON-ready. */
  async load(businessId: string, currency: string): Promise<DashboardData> {
    const [summary, unpaidTotal, todayBookings, unpaidInvoices, revenueByItem, ordersToSendOut, runningLow] =
      await Promise.all([
        this.summary(businessId),
        this.unpaidTotal(businessId),
        this.todayBookings(businessId),
        this.unpaidInvoices(businessId, 5),
        this.revenueByItem(businessId),
        this.ordersToSendOut(businessId),
        this.runningLow(businessId),
      ]);

    return {
      currency,
      summary: { ...summary, unpaidTotal },
      todayBookings: todayBookings.map((b) => ({
        ...b,
        at: b.at.toISOString(),
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
      })),
      unpaidInvoices,
      revenueByItem,
      ordersToSendOut,
      runningLow,
    };
  }
}

export const dashboardService = new DashboardService();

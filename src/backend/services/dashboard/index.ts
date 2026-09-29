import type { InvoiceStatus, Prisma } from "@prisma/client";

import type { DashboardData } from "types";

import { db } from "@/server/db";

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
  startTime: Date;
  endTime: Date;
  status: "PENDING" | "CONFIRMED";
  clientName: string;
  serviceName: string;
};

export type ServiceRevenue = {
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  totalRevenue: number;
  totalBookings: number;
};

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

  /** Still-happening bookings today, in time order. */
  async todayBookings(businessId: string): Promise<TodayBooking[]> {
    const bookings = await db.booking.findMany({
      where: {
        businessId,
        startTime: { gte: startOfToday(), lt: endOfToday() },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      orderBy: { startTime: "asc" },
      take: 20,
      select: {
        slug: true,
        startTime: true,
        endTime: true,
        status: true,
        clientName: true,
        service: { select: { name: true } },
      },
    });
    return bookings.map((b) => ({
      slug: b.slug,
      startTime: b.startTime,
      endTime: b.endTime,
      status: b.status as TodayBooking["status"],
      clientName: b.clientName,
      serviceName: b.service.name,
    }));
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

  /** Everything the dashboard shows, in one call, JSON-ready. */
  async load(businessId: string, currency: string): Promise<DashboardData> {
    const [summary, unpaidTotal, todayBookings, unpaidInvoices, revenue] =
      await Promise.all([
        this.summary(businessId),
        this.unpaidTotal(businessId),
        this.todayBookings(businessId),
        this.unpaidInvoices(businessId, 5),
        this.revenueByService(businessId),
      ]);

    return {
      currency,
      summary: { ...summary, unpaidTotal },
      todayBookings: todayBookings.map((b) => ({
        ...b,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
      })),
      unpaidInvoices,
      revenueByService: revenue.services,
    };
  }
}

export const dashboardService = new DashboardService();

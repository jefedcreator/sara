import type { Prisma } from "@prisma/client";

import { customerService } from "@/backend/services/customer";
import { dashboardService } from "@/backend/services/dashboard";
import { documentService } from "@/backend/services/documents";
import { formatMoney } from "@/backend/services/messaging/engine/amount";
import { productService } from "@/backend/services/product";
import { activeHoldsWhere } from "@/backend/services/product/stock";
import { db } from "@/server/db";
import { productLink, publicLink, serviceLink } from "@/server/share";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";

import { periodRange, type PeriodRange } from "../clock";
import type { AssistantScope } from "../types";
import { readRequestSchema } from "./schemas";

type JsonValue = Prisma.JsonValue;
export type ReadResult = { data: JsonValue; text: string };

const LIST_LIMIT = 20;
const TEXT_LIMIT = 8_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short",
});

function result(data: JsonValue, text: string): ReadResult {
  const suffix = "\nReply shortened. Narrow your request for more detail.";
  return { data, text: text.length <= TEXT_LIMIT ? text : text.slice(0, TEXT_LIMIT - suffix.length) + suffix };
}

function listing(shown: number, total: number, noun: string): string {
  if (!total) return `No ${noun} found.`;
  return shown < total
    ? `Showing ${shown} of ${total} ${noun}. Narrow your request to see more.`
    : `${total} ${noun}.`;
}

async function businessCurrency(businessId: string): Promise<string> {
  // Never load the business's bank details or calendar credentials.
  const business = await db.business.findFirst({ where: { id: businessId }, select: { currency: true } });
  if (!business) throw new NotFoundException("Business not found");
  return business.currency;
}

function bookingRange(from: string, to: string): PeriodRange {
  const parse = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00+01:00` : value);
  const range = { from: parse(from), to: parse(to) };
  const duration = range.to.getTime() - range.from.getTime();
  if (!Number.isFinite(duration) || duration <= 0 || duration > 31 * DAY_MS) {
    throw new BadRequestException("Choose a booking range of at most 31 days, with the end after the start");
  }
  return range;
}

/** Validated read-only facts from the trusted business; no model-written totals. */
export async function executeRead(scope: AssistantScope, request: unknown, now: Date): Promise<ReadResult> {
  const args = readRequestSchema.parse(request);
  const { businessId } = scope;

  switch (args.name) {
    case "find_customers": {
      const found = await customerService.list(businessId, { query: args.query, page: 1, size: 3 });
      const customers = found.data.slice(0, 3).map((customer) => ({
        id: customer.id, name: customer.name, phone: customer.phone, email: customer.email,
        lastActivityAt: customer.lastActivityAt,
      }));
      const text = [
        listing(customers.length, found.total, "matching customers"),
        ...(found.total > 1 ? ["Several customers match. Choose using their contact details."] : []),
        ...customers.map((customer, index) => `${index + 1}. ${customer.name} · ${customer.phone ?? customer.email ?? "No contact details"}${customer.phone && customer.email ? ` · ${customer.email}` : ""} · ID ${customer.id}`),
      ].join("\n");
      return result({ customers, total: found.total, truncated: customers.length < found.total }, text);
    }
    case "get_customer": {
      const customer = await customerService.detail(businessId, args.customerId);
      const currency = await businessCurrency(businessId);
      const timeline = customer.timeline.slice(0, LIST_LIMIT).map((entry) => ({ ...entry, amount: entry.amount.toString() }));
      return result({
        id: customer.id, name: customer.name, phone: customer.phone, email: customer.email,
        spent: customer.spent.toString(), owes: customer.owes.toString(), currency,
        lastActivityAt: customer.lastActivityAt, timeline, totalHistory: customer.timeline.length,
        truncated: timeline.length < customer.timeline.length,
      }, [
        `${customer.name} · Spent ${formatMoney(customer.spent, currency)} · Owes ${formatMoney(customer.owes, currency)}`,
        listing(timeline.length, customer.timeline.length, "history entries"),
        ...customer.timeline.slice(0, LIST_LIMIT).map((entry) => `${entry.label} · ${entry.status} · ${formatMoney(entry.amount, currency)} · ${dateTime.format(new Date(entry.at))} Lagos`),
      ].join("\n"));
    }
    case "list_items": {
      const [services, products, currency] = await Promise.all([
        db.service.findMany({
          where: { businessId, ...(args.includeInactive ? {} : { isActive: true }), ...(args.query && { name: { contains: args.query, mode: "insensitive" as const } }) },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: { id: true, name: true, price: true, isActive: true, bookingMode: true, duration: true, minUnits: true, maxUnits: true },
        }),
        productService.list(businessId, { includeInactive: args.includeInactive }),
        businessCurrency(businessId),
      ]);
      const term = args.query?.toLowerCase();
      const matchingProducts = products.filter((product) => !term || product.name.toLowerCase().includes(term) || product.options.some((option) => option.name.toLowerCase().includes(term)));
      // A single combined cap applies to services and products, rather than 20 of each.
      const selectedServices = services.slice(0, LIST_LIMIT);
      const selectedProducts = matchingProducts.slice(0, LIST_LIMIT - selectedServices.length);
      const optionIds = selectedProducts.flatMap((product) => product.options.slice(0, LIST_LIMIT).map((option) => option.id));
      const held = optionIds.length ? await db.orderLine.groupBy({
        by: ["productOptionId"],
        where: { productOptionId: { in: optionIds }, order: { businessId, ...activeHoldsWhere(now) } },
        _sum: { quantity: true },
      }) : [];
      const holds = new Map(held.map((row) => [row.productOptionId, row._sum.quantity ?? 0]));
      const items = [
        ...selectedServices.map((service) => ({
          kind: "service" as const, id: service.id, name: service.name, price: service.price.toString(), currency,
          isActive: service.isActive, bookingMode: service.bookingMode, durationMinutes: service.duration,
          unit: service.bookingMode === "NIGHTLY" ? "night" : service.bookingMode === "DAILY" ? "day" : "slot",
          minUnits: service.minUnits, maxUnits: service.maxUnits,
        })),
        ...selectedProducts.map((product) => ({
          kind: "product" as const, id: product.id, name: product.name, price: product.price.toString(), currency,
          isActive: product.isActive, tracksStock: product.tracksStock, unit: "item",
          totalOptions: product.options.length, optionsTruncated: product.options.length > LIST_LIMIT,
          options: product.options.slice(0, LIST_LIMIT).map((option) => ({
            id: option.id, name: option.name, price: (option.price ?? product.price).toString(),
            stock: product.tracksStock ? option.stock : null,
            availableStock: product.tracksStock ? Math.max(0, option.stock - (holds.get(option.id) ?? 0)) : null,
          })),
        })),
      ];
      const total = services.length + matchingProducts.length;
      const itemText = items.map((item, index) => {
        const heading = `${index + 1}. ${item.name} · ${item.kind} · ${formatMoney(Number(item.price), currency)} per ${item.unit}${item.isActive ? "" : " · Paused"} · ID ${item.id}`;
        if (item.kind === "service") return heading;
        const options = item.options.map((option) => {
          const stock = option.availableStock === null
            ? "Made to order"
            : `${option.availableStock} available (${option.stock} in stock)`;
          return `  ${option.name || "Default"} · ${formatMoney(Number(option.price), currency)} · ${stock} · Option ID ${option.id}`;
        });
        return [heading, ...options, ...(item.optionsTruncated ? ["  More options omitted."] : [])].join("\n");
      });
      return result({ items, total, truncated: items.length < total }, [
        listing(items.length, total, "matching items"), ...itemText,
      ].join("\n"));
    }
    case "unpaid_invoices": {
      if (args.customerId) await customerService.ownedBy(db, businessId, args.customerId);
      const filters = {
        ...(args.customerId && { customerId: args.customerId }),
        ...(args.period === "all" ? {} : periodRange(args.period, now)),
      };
      const [allRows, summary] = await Promise.all([
        dashboardService.unpaidInvoices(businessId, LIST_LIMIT, filters),
        dashboardService.unpaidInvoiceSummary(businessId, filters),
      ]);
      const rows = allRows.slice(0, LIST_LIMIT);
      return result({
        invoices: rows.map((row) => ({ ...row, outstanding: row.outstanding.toString() })),
        total: summary.count,
        outstandingByCurrency: summary.byCurrency.slice(0, LIST_LIMIT).map((row) => ({ ...row, outstanding: row.outstanding.toString() })),
        totalCurrencies: summary.byCurrency.length,
        truncated: rows.length < summary.count || summary.byCurrency.length > LIST_LIMIT,
      }, [
        listing(rows.length, summary.count, "unpaid invoices"),
        ...(args.period === "all" ? [] : ["Period filters refer to the invoice due date (Lagos time)."]),
        ...summary.byCurrency.slice(0, LIST_LIMIT).map((group) => `Total outstanding: ${formatMoney(group.outstanding, group.currency)} across ${group.count} invoices.`),
        ...(summary.byCurrency.length > LIST_LIMIT ? ["Additional currency totals omitted."] : []),
        ...rows.map((row, index) => `${index + 1}. ${row.invoiceNumber} · ${row.clientName} · ${formatMoney(row.outstanding, row.currency)}`),
      ].join("\n"));
    }
    case "list_bookings": {
      const range = bookingRange(args.from, args.to);
      const all = await dashboardService.bookingsInRange(businessId, range, now);
      const events = all.slice(0, LIST_LIMIT);
      return result({
        from: range.from.toISOString(), to: range.to.toISOString(), endExclusive: true,
        events: events.map((event) => ({ ...event, at: event.at.toISOString(), startTime: event.startTime.toISOString(), endTime: event.endTime.toISOString() })),
        total: all.length, truncated: events.length < all.length,
      }, [
        listing(events.length, all.length, "booking events"),
        "Times are in Lagos. The range includes its start and excludes its end.",
        ...events.map((event, index) => `${index + 1}. ${event.kind.replaceAll("_", " ")} · ${dateTime.format(event.at)} · ${event.clientName} · ${event.serviceName} · ${event.units} units · ${event.status}`),
      ].join("\n"));
    }
    case "orders_to_send": {
      const [allRows, total, currency] = await Promise.all([
        dashboardService.ordersToSendOut(businessId),
        db.order.count({ where: { businessId, status: { in: ["NEW", "READY"] } } }),
        businessCurrency(businessId),
      ]);
      const orders = allRows.slice(0, LIST_LIMIT);
      return result({ orders: orders.map((order) => ({ ...order, total: order.total.toString() })), total, truncated: orders.length < total }, [
        listing(orders.length, total, "orders to send"),
        ...orders.map((order, index) => `${index + 1}. ${order.orderNumber} · ${order.clientName} · ${order.status} · ${order.fulfilment} · ${formatMoney(order.total, currency)}`),
      ].join("\n"));
    }
    case "business_summary": {
      const range = periodRange(args.period, now);
      const [summary, allItems, currency] = await Promise.all([
        dashboardService.summaryForPeriod(businessId, range),
        args.byItem ? dashboardService.revenueByItem(businessId, range) : Promise.resolve([]),
        businessCurrency(businessId),
      ]);
      const items = allItems.slice(0, LIST_LIMIT);
      return result({
        period: args.period, from: range.from.toISOString(), to: range.to.toISOString(), currency,
        revenue: summary.revenue.toString(), unpaidCount: summary.unpaidCount, unpaidTotal: summary.unpaidTotal.toString(),
        items: items.map((item) => ({ ...item, totalRevenue: item.totalRevenue.toString() })),
        totalItems: allItems.length, truncated: items.length < allItems.length,
      }, [
        `Payments received this ${args.period === "today" ? "day" : args.period}: ${formatMoney(summary.revenue, currency)}.`,
        `Currently unpaid: ${summary.unpaidCount} invoices · ${formatMoney(summary.unpaidTotal, currency)} outstanding across all periods.`,
        ...(args.byItem ? [
          listing(items.length, allItems.length, "items with sales"),
          "Item figures use current service prices and order lines, grouped by creation date. They can differ from payments received.",
          ...items.map((item, index) => `${index + 1}. ${item.name} · ${formatMoney(item.totalRevenue, currency)} · ${item.count} ${item.kind === "SERVICE" ? "bookings" : "units"}`),
        ] : []),
      ].join("\n"));
    }
    case "find_document": {
      const document = await documentService.find(businessId, args.kind, args.number);
      if (!document) return result(null, `No ${args.kind} with number ${args.number} found.`);
      const lines = document.lines.slice(0, LIST_LIMIT);
      const url = publicLink(document.kind, document.publicId);
      return result({ ...document, lines, totalLines: document.lines.length, truncated: lines.length < document.lines.length, url }, [
        `${document.number} · ${document.clientName ?? "Customer"} · ${document.status} · ${formatMoney(Number(document.total), document.currency)}`,
        ...(document.amountPaid === null ? [] : [`Paid: ${formatMoney(Number(document.amountPaid), document.currency)}.`]),
        listing(lines.length, document.lines.length, "document lines"),
        ...lines.map((line) => `${line.quantity} × ${line.name} · ${formatMoney(Number(line.unitPrice), document.currency)} each · ${formatMoney(Number(line.total), document.currency)}`),
        url,
      ].join("\n"));
    }
    case "share_link": {
      const where = { id: args.id, businessId, isActive: true };
      const select = { id: true, name: true, slug: true } as const;
      const item = args.kind === "service"
        ? await db.service.findFirst({ where, select })
        : await db.product.findFirst({ where, select });
      if (!item) throw new NotFoundException("Active item not found for this business");
      const url = args.kind === "service" ? serviceLink(item.slug) : productLink(item.slug);
      return result({ kind: args.kind, id: item.id, name: item.name, url }, `${item.name}: ${url}`);
    }
  }
}

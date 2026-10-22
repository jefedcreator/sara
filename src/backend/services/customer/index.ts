import type { Customer, Prisma } from "@prisma/client";

import { UNPAID_STATUSES } from "@/backend/services/dashboard";
import { db } from "@/server/db";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@/utils/exceptions";
import { publicPath } from "@/utils/public-links";
import type { CustomerDetail, CustomerListItem, TimelineEntry } from "types";

import { nameKey, normalizeEmail, normalizePhone } from "./normalize";

export { nameKey, normalizeEmail, normalizePhone } from "./normalize";

export type CustomerInput = {
  businessId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
};

/**
 * The one delegate these helpers need. Both `PrismaClient` and a transaction
 * client satisfy it, so bookings can resolve their customer just before the
 * serializable insert without a cast.
 */
export type CustomerClient = Pick<Prisma.TransactionClient, "customer">;

export type CustomerListOptions = {
  query?: string;
  page: number;
  size: number;
};

/** The most customers the chat offers when a typed name could mean several. */
const SIMILAR_LIMIT = 5;

export type UpdateCustomerInput = {
  name?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
};

/**
 * The forms of a typed phone number worth searching for. A stored number is
 * E.164 ("+2348035550142"), while the owner types "0803 555" or "234803…",
 * so search the raw digits and the local form without its prefix.
 */
function phoneSearchValues(query: string): string[] {
  const digits = query.replace(/\D/g, "");
  if (!digits) return [];

  const values = new Set([digits]);
  if (digits.startsWith("234")) values.add(digits.slice(3));
  if (digits.startsWith("0")) values.add(digits.slice(1));

  return [...values].filter(Boolean);
}

/** The message for a P2002 when another customer owns the phone or email. */
function uniqueConflictMessage(
  error: unknown,
  patch: UpdateCustomerInput,
): string {
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const fields = Array.isArray(target)
    ? target.map(String)
    : typeof target === "string"
      ? [target]
      : [];

  if (fields.some((field) => field.toLowerCase().includes("email"))) {
    return "Another customer already has this email address";
  }
  if (fields.some((field) => field.toLowerCase().includes("phone"))) {
    return "Another customer already has this phone number";
  }

  // Some drivers omit the target. Fall back to what the patch changed.
  if (patch.email !== undefined && patch.phone === undefined) {
    return "Another customer already has this email address";
  }
  return "Another customer already has this phone number";
}

/** Keep the newest date seen for each customer. */
function noteLatest(
  latest: Map<string, Date>,
  rows: { customerId: string | null; createdAt: Date | null }[],
) {
  for (const row of rows) {
    if (!row.customerId || !row.createdAt) continue;

    const current = latest.get(row.customerId);
    if (!current || row.createdAt.getTime() > current.getTime()) {
      latest.set(row.customerId, row.createdAt);
    }
  }
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * What a matched customer is missing and the new record can fill in. Existing
 * phone and email values are never replaced. The address follows the latest
 * delivery.
 */
function fillMissing(
  existing: Customer,
  input: { phone: string | null; email: string | null; address: string | null },
): Prisma.CustomerUpdateInput {
  const data: Prisma.CustomerUpdateInput = {};

  if (input.phone && !existing.phone) data.phone = input.phone;
  if (input.email && !existing.email) data.email = input.email;
  if (input.address && input.address !== existing.address) {
    data.address = input.address;
  }

  return data;
}

class CustomerService {
  /**
   * Find or create the customer a record describes. Phone wins over email,
   * and a name only matches when the record is name-only or the one customer
   * with that name has no contact details yet, so a new phone or email always
   * becomes a new customer instead of overwriting the one on file.
   */
  async resolve(
    client: CustomerClient,
    input: CustomerInput,
  ): Promise<Customer | null> {
    const phone = normalizePhone(input.phone);
    const email = normalizeEmail(input.email);
    // `||`: blank text counts as none.
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
    const name = input.name?.trim() || null;
    const address = input.address?.trim() || null;
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

    if (!name && !phone && !email) return null;

    if (phone) {
      const existing = await client.customer.findUnique({
        where: { businessId_phone: { businessId: input.businessId, phone } },
      });

      if (existing) {
        return this.updateMissing(client, existing, { phone, email, address });
      }
    }

    if (email) {
      const existing = await client.customer.findUnique({
        where: { businessId_email: { businessId: input.businessId, email } },
      });

      if (existing) {
        return this.updateMissing(client, existing, { phone, email, address });
      }
    }

    if (name) {
      const where: Prisma.CustomerWhereInput = {
        businessId: input.businessId,
        nameKey: nameKey(name),
      };

      // With contact details in hand, only a name-only customer can be the
      // same person; anyone with a phone or email on file is left alone.
      if (phone || email) {
        where.phone = null;
        where.email = null;
      }

      const matches = await client.customer.findMany({ where, take: 2 });

      if (matches.length === 1) {
        return this.updateMissing(client, matches[0]!, { phone, email, address });
      }
    }

    const displayName = name ?? phone ?? email!;

    try {
      return await client.customer.create({
        data: {
          businessId: input.businessId,
          name: displayName,
          nameKey: nameKey(displayName),
          phone,
          email,
          address,
        },
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;

      // Another request created the same phone or email first. Take theirs.
      const found = await this.findByContact(client, input.businessId, phone, email);
      if (found) return found;
      throw error;
    }
  }

  /**
   * The customers a typed name could mean, for the chat's "Customer's name?"
   * step. `exact` is the one customer whose name equals it; `similar` are the
   * customers whose name starts with it as whole words ("Tolu" finds "Tolu
   * Adeyemi", not "Tolulope"), at most five. When two or more customers share
   * the exact name, there is no `exact` and they lead `similar`, so the owner
   * picks between them.
   */
  async findByName(
    businessId: string,
    name: string,
  ): Promise<{ exact: Customer | null; similar: Customer[] }> {
    const key = nameKey(name);
    if (!key) return { exact: null, similar: [] };

    const [named, longer] = await Promise.all([
      db.customer.findMany({
        where: { businessId, nameKey: key },
        orderBy: { createdAt: "asc" },
        take: SIMILAR_LIMIT,
      }),
      db.customer.findMany({
        where: { businessId, nameKey: { startsWith: `${key} ` } },
        orderBy: { nameKey: "asc" },
        take: SIMILAR_LIMIT,
      }),
    ]);

    if (named.length === 1) return { exact: named[0]!, similar: longer };

    return { exact: null, similar: [...named, ...longer].slice(0, SIMILAR_LIMIT) };
  }

  /** A customer the business owns, or a 400 like the other document links. */
  async ownedBy(
    client: CustomerClient,
    businessId: string,
    customerId: string,
  ): Promise<Customer> {
    const customer = await client.customer.findFirst({
      where: { id: customerId, businessId },
    });

    if (!customer) {
      throw new BadRequestException("Customer not found for this business");
    }

    return customer;
  }

  /**
   * The owner's customer list, searched and sorted by most recent activity.
   * Totals are only computed for the page, while the activity dates cover
   * every match so the page order is right.
   */
  async list(
    businessId: string,
    options: CustomerListOptions,
  ): Promise<{ data: CustomerListItem[]; total: number }> {
    const { query, page, size } = options;
    const where: Prisma.CustomerWhereInput = { businessId };
    const term = query?.trim();

    if (term) {
      const matches: Prisma.CustomerWhereInput[] = [
        { name: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
      ];
      for (const digits of phoneSearchValues(term)) {
        matches.push({ phone: { contains: digits } });
      }
      where.OR = matches;
    }

    const customers = await db.customer.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        createdAt: true,
      },
    });

    const latest = await this.latestActivity(
      businessId,
      customers.map((customer) => customer.id),
    );

    const activityTime = (customer: { id: string; createdAt: Date }) =>
      (latest.get(customer.id) ?? customer.createdAt).getTime();

    customers.sort(
      (a, b) =>
        activityTime(b) - activityTime(a) || a.name.localeCompare(b.name),
    );

    const safePage = Math.max(1, page);
    const safeSize = Math.max(1, size);
    const start = (safePage - 1) * safeSize;
    const pageCustomers = customers.slice(start, start + safeSize);
    const figures = await this.figures(
      businessId,
      pageCustomers.map((customer) => customer.id),
    );

    const data = pageCustomers.map((customer) => {
      const figure = figures.get(customer.id)!;
      const at = latest.get(customer.id);

      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        spent: figure.spent,
        owes: figure.owes,
        lastActivityAt: at ? at.toISOString() : null,
      };
    });

    return { data, total: customers.length };
  }

  /** One customer, what they spent and owe, and their newest-first history. */
  async detail(businessId: string, id: string): Promise<CustomerDetail> {
    const customer = await this.requireOwned(db, businessId, id);

    const [
      paymentAgg,
      receiptAgg,
      invoiceAgg,
      bookings,
      invoices,
      receipts,
      orders,
    ] = await Promise.all([
      db.payment.aggregate({
        where: { businessId, customerId: id },
        _sum: { amount: true },
        _max: { createdAt: true },
      }),
      db.receipt.aggregate({
        where: { businessId, customerId: id, paymentId: null },
        _sum: { amountPaid: true },
      }),
      db.invoice.aggregate({
        where: {
          businessId,
          customerId: id,
          status: { in: UNPAID_STATUSES },
        },
        _sum: { total: true, amountPaid: true },
      }),
      db.booking.findMany({
        where: { businessId, customerId: id },
        select: {
          id: true,
          publicId: true,
          status: true,
          amount: true,
          createdAt: true,
          service: { select: { name: true } },
        },
      }),
      db.invoice.findMany({
        where: { businessId, customerId: id },
        select: {
          id: true,
          publicId: true,
          invoiceNumber: true,
          status: true,
          total: true,
          createdAt: true,
        },
      }),
      db.receipt.findMany({
        where: { businessId, customerId: id },
        select: {
          id: true,
          publicId: true,
          receiptNumber: true,
          amountPaid: true,
          createdAt: true,
        },
      }),
      db.order.findMany({
        where: {
          businessId,
          customerId: id,
          status: { not: "AWAITING_PAYMENT" },
        },
        select: {
          id: true,
          publicId: true,
          orderNumber: true,
          status: true,
          total: true,
          createdAt: true,
        },
      }),
    ]);

    const spent =
      Number(paymentAgg._sum.amount ?? 0) +
      Number(receiptAgg._sum.amountPaid ?? 0);
    const owes =
      Number(invoiceAgg._sum.total ?? 0) -
      Number(invoiceAgg._sum.amountPaid ?? 0);

    const timeline: TimelineEntry[] = [
      ...bookings.map((booking) => ({
        kind: "booking" as const,
        id: booking.id,
        label: `Booking · ${booking.service.name}`,
        amount: Number(booking.amount),
        status: booking.status,
        at: booking.createdAt.toISOString(),
        href: publicPath("booking", booking.publicId),
      })),
      ...invoices.map((invoice) => ({
        kind: "invoice" as const,
        id: invoice.id,
        label: `Invoice ${invoice.invoiceNumber}`,
        amount: Number(invoice.total),
        status: invoice.status,
        at: invoice.createdAt.toISOString(),
        href: publicPath("invoice", invoice.publicId),
      })),
      ...receipts.map((receipt) => ({
        kind: "receipt" as const,
        id: receipt.id,
        label: `Receipt ${receipt.receiptNumber}`,
        amount: Number(receipt.amountPaid),
        status: "PAID",
        at: receipt.createdAt.toISOString(),
        href: publicPath("receipt", receipt.publicId),
      })),
      ...orders.map((order) => ({
        kind: "order" as const,
        id: order.id,
        label: order.orderNumber ? `Order ${order.orderNumber}` : "Order",
        amount: Number(order.total),
        status: order.status,
        at: order.createdAt.toISOString(),
        href: publicPath("order", order.publicId),
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    const activityDates = [
      ...bookings.map((booking) => booking.createdAt),
      ...invoices.map((invoice) => invoice.createdAt),
      ...receipts.map((receipt) => receipt.createdAt),
      ...orders.map((order) => order.createdAt),
      ...(paymentAgg._max.createdAt ? [paymentAgg._max.createdAt] : []),
    ];
    const lastActivityAt =
      activityDates.length > 0
        ? new Date(
            Math.max(...activityDates.map((date) => date.getTime())),
          ).toISOString()
        : null;

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      spent,
      owes,
      lastActivityAt,
      address: customer.address,
      notes: customer.notes,
      createdAt: customer.createdAt.toISOString(),
      timeline,
    };
  }

  /** Edit contact details, normalising the matching fields that changed. */
  async update(
    businessId: string,
    id: string,
    patch: UpdateCustomerInput,
  ): Promise<Customer> {
    await this.requireOwned(db, businessId, id);

    const data: Prisma.CustomerUpdateInput = {};

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      data.name = name;
      data.nameKey = nameKey(name);
    }
    if (patch.phone !== undefined) data.phone = normalizePhone(patch.phone);
    if (patch.email !== undefined) data.email = normalizeEmail(patch.email);
    // `||`: blank text clears the field.
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
    if (patch.address !== undefined) {
      data.address = patch.address?.trim() || null;
    }
    if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

    try {
      return await db.customer.update({ where: { id }, data });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      throw new ConflictException(uniqueConflictMessage(error, patch));
    }
  }

  /**
   * Move every record to the kept customer, then remove the other one. The
   * delete comes before filling the kept customer's missing phone or email,
   * so the merged customer's unique values are free by the time they move.
   */
  async merge(
    businessId: string,
    keepId: string,
    mergeId: string,
  ): Promise<Customer> {
    if (keepId === mergeId) {
      throw new BadRequestException("Choose two different customers to merge");
    }

    return db.$transaction(async (tx) => {
      const keep = await this.requireOwned(tx, businessId, keepId);
      const merged = await this.requireOwned(tx, businessId, mergeId);

      await Promise.all([
        tx.booking.updateMany({
          where: { customerId: mergeId },
          data: { customerId: keepId },
        }),
        tx.invoice.updateMany({
          where: { customerId: mergeId },
          data: { customerId: keepId },
        }),
        tx.receipt.updateMany({
          where: { customerId: mergeId },
          data: { customerId: keepId },
        }),
        tx.payment.updateMany({
          where: { customerId: mergeId },
          data: { customerId: keepId },
        }),
        tx.order.updateMany({
          where: { customerId: mergeId },
          data: { customerId: keepId },
        }),
      ]);

      await tx.customer.delete({ where: { id: mergeId } });

      const data: Prisma.CustomerUpdateInput = {};
      if (!keep.phone && merged.phone) data.phone = merged.phone;
      if (!keep.email && merged.email) data.email = merged.email;
      if (!keep.address && merged.address) data.address = merged.address;
      if (!keep.notes && merged.notes) data.notes = merged.notes;

      if (Object.keys(data).length === 0) return keep;

      return tx.customer.update({ where: { id: keepId }, data });
    });
  }

  /** Newest record date per customer, across every kind of activity. */
  private async latestActivity(
    businessId: string,
    customerIds: string[],
  ): Promise<Map<string, Date>> {
    const latest = new Map<string, Date>();
    if (customerIds.length === 0) return latest;

    const where = { businessId, customerId: { in: customerIds } };
    const [bookings, invoices, receipts, payments, orders] = await Promise.all([
      db.booking.groupBy({
        by: ["customerId"],
        where,
        _max: { createdAt: true },
      }),
      db.invoice.groupBy({
        by: ["customerId"],
        where,
        _max: { createdAt: true },
      }),
      db.receipt.groupBy({
        by: ["customerId"],
        where,
        _max: { createdAt: true },
      }),
      db.payment.groupBy({
        by: ["customerId"],
        where,
        _max: { createdAt: true },
      }),
      db.order.groupBy({
        by: ["customerId"],
        // An abandoned checkout is not activity the owner can see.
        where: { ...where, status: { not: "AWAITING_PAYMENT" } },
        _max: { createdAt: true },
      }),
    ]);

    const rows = (
      groups: { customerId: string | null; _max: { createdAt: Date | null } }[],
    ) =>
      groups.map((group) => ({
        customerId: group.customerId,
        createdAt: group._max.createdAt,
      }));

    noteLatest(latest, rows(bookings));
    noteLatest(latest, rows(invoices));
    noteLatest(latest, rows(receipts));
    noteLatest(latest, rows(payments));
    noteLatest(latest, rows(orders));

    return latest;
  }

  /** Spent and owed figures for a known set of customers. */
  private async figures(
    businessId: string,
    customerIds: string[],
  ): Promise<Map<string, { spent: number; owes: number }>> {
    const figures = new Map<string, { spent: number; owes: number }>();
    for (const id of customerIds) figures.set(id, { spent: 0, owes: 0 });
    if (customerIds.length === 0) return figures;

    const [payments, receipts, invoices] = await Promise.all([
      db.payment.groupBy({
        by: ["customerId"],
        where: { businessId, customerId: { in: customerIds } },
        _sum: { amount: true },
      }),
      db.receipt.groupBy({
        by: ["customerId"],
        where: {
          businessId,
          customerId: { in: customerIds },
          paymentId: null,
        },
        _sum: { amountPaid: true },
      }),
      db.invoice.groupBy({
        by: ["customerId"],
        where: {
          businessId,
          customerId: { in: customerIds },
          status: { in: UNPAID_STATUSES },
        },
        _sum: { total: true, amountPaid: true },
      }),
    ]);

    for (const payment of payments) {
      if (!payment.customerId) continue;
      const figure = figures.get(payment.customerId);
      if (figure) figure.spent += Number(payment._sum?.amount ?? 0);
    }

    for (const receipt of receipts) {
      if (!receipt.customerId) continue;
      const figure = figures.get(receipt.customerId);
      if (figure) figure.spent += Number(receipt._sum?.amountPaid ?? 0);
    }

    for (const invoice of invoices) {
      if (!invoice.customerId) continue;
      const figure = figures.get(invoice.customerId);
      if (!figure) continue;

      figure.owes +=
        Number(invoice._sum?.total ?? 0) -
        Number(invoice._sum?.amountPaid ?? 0);
    }

    return figures;
  }

  /** A customer the business owns, surfaced as a 404 for API reads and edits. */
  private async requireOwned(
    client: CustomerClient,
    businessId: string,
    id: string,
  ): Promise<Customer> {
    try {
      return await this.ownedBy(client, businessId, id);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw new NotFoundException("Customer not found");
      }
      throw error;
    }
  }

  private async updateMissing(
    client: CustomerClient,
    existing: Customer,
    input: { phone: string | null; email: string | null; address: string | null },
  ): Promise<Customer> {
    const data = fillMissing(existing, input);

    if (Object.keys(data).length === 0) return existing;

    return client.customer.update({ where: { id: existing.id }, data });
  }

  private async findByContact(
    client: CustomerClient,
    businessId: string,
    phone: string | null,
    email: string | null,
  ): Promise<Customer | null> {
    if (phone) {
      const found = await client.customer.findUnique({
        where: { businessId_phone: { businessId, phone } },
      });
      if (found) return found;
    }

    if (email) {
      return client.customer.findUnique({
        where: { businessId_email: { businessId, email } },
      });
    }

    return null;
  }
}

export const customerService = new CustomerService();

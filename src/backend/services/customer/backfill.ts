import { db } from "@/server/db";

import { customerService } from "./index";

export type CustomerBackfillOptions = {
  batchSize?: number;
};

export type CustomerBackfillCounts = {
  bookings: number;
  invoices: number;
  receipts: number;
  payments: number;
};

const DEFAULT_BATCH_SIZE = 200;

type PageArgs = {
  take: number;
  cursor?: { id: string };
  skip?: number;
};

/**
 * Page through customerId-null records by id and link the ones a customer
 * could be resolved for. A cursor keeps unresolvable records from stalling
 * the run; they are simply tried again next time.
 */
async function pageUnlinked<T extends { id: string }>(
  fetchPage: (args: PageArgs) => Promise<T[]>,
  batchSize: number,
  handle: (row: T) => Promise<boolean>,
): Promise<number> {
  let cursor: string | undefined;
  let linked = 0;

  for (;;) {
    const rows = await fetchPage({
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      if (await handle(row)) linked += 1;
    }

    if (rows.length < batchSize) break;
    cursor = rows[rows.length - 1]!.id;
  }

  return linked;
}

class CustomerBackfill {
  /**
   * Link existing bookings, invoices, receipts and payments to customers
   * created from their name, phone and email snapshots. Safe to run twice:
   * linked records are never selected again.
   */
  async run(
    opts: CustomerBackfillOptions = {},
  ): Promise<CustomerBackfillCounts> {
    const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);

    return {
      bookings: await this.linkBookings(batchSize),
      invoices: await this.linkInvoices(batchSize),
      receipts: await this.linkReceipts(batchSize),
      payments: await this.linkPayments(batchSize),
    };
  }

  private linkBookings(batchSize: number): Promise<number> {
    return pageUnlinked(
      (args) =>
        db.booking.findMany({
          where: { customerId: null },
          orderBy: { id: "asc" },
          select: {
            id: true,
            businessId: true,
            clientName: true,
            clientPhone: true,
            clientEmail: true,
          },
          ...args,
        }),
      batchSize,
      (booking) =>
        db.$transaction(async (tx) => {
          const customer = await customerService.resolve(tx, {
            businessId: booking.businessId,
            name: booking.clientName,
            phone: booking.clientPhone,
            email: booking.clientEmail,
          });

          if (!customer) return false;

          await tx.booking.update({
            where: { id: booking.id },
            data: { customerId: customer.id },
          });
          return true;
        }),
    );
  }

  private linkInvoices(batchSize: number): Promise<number> {
    return pageUnlinked(
      (args) =>
        db.invoice.findMany({
          where: { customerId: null },
          orderBy: { id: "asc" },
          select: {
            id: true,
            businessId: true,
            clientName: true,
            clientPhone: true,
            clientEmail: true,
          },
          ...args,
        }),
      batchSize,
      (invoice) =>
        db.$transaction(async (tx) => {
          const customer = await customerService.resolve(tx, {
            businessId: invoice.businessId,
            name: invoice.clientName,
            phone: invoice.clientPhone,
            email: invoice.clientEmail,
          });

          if (!customer) return false;

          await tx.invoice.update({
            where: { id: invoice.id },
            data: { customerId: customer.id },
          });
          return true;
        }),
    );
  }

  private linkReceipts(batchSize: number): Promise<number> {
    return pageUnlinked(
      (args) =>
        db.receipt.findMany({
          where: { customerId: null },
          orderBy: { id: "asc" },
          select: {
            id: true,
            businessId: true,
            name: true,
            phone: true,
            email: true,
          },
          ...args,
        }),
      batchSize,
      (receipt) =>
        db.$transaction(async (tx) => {
          const customer = await customerService.resolve(tx, {
            businessId: receipt.businessId,
            name: receipt.name,
            phone: receipt.phone,
            email: receipt.email,
          });

          if (!customer) return false;

          await tx.receipt.update({
            where: { id: receipt.id },
            data: { customerId: customer.id },
          });
          return true;
        }),
    );
  }

  private linkPayments(batchSize: number): Promise<number> {
    return pageUnlinked(
      (args) =>
        db.payment.findMany({
          where: { customerId: null },
          orderBy: { id: "asc" },
          select: {
            id: true,
            businessId: true,
            clientName: true,
            clientPhone: true,
            clientEmail: true,
            booking: { select: { customerId: true } },
            invoice: { select: { customerId: true } },
          },
          ...args,
        }),
      batchSize,
      (payment) => {
        // The booking or invoice already knows whose payment this is; only a
        // payment with neither falls back to its own snapshot.
        const inherited =
          payment.booking?.customerId ?? payment.invoice?.customerId ?? null;

        if (inherited) {
          return db.$transaction(async (tx) => {
            await tx.payment.update({
              where: { id: payment.id },
              data: { customerId: inherited },
            });
            return true;
          });
        }

        return db.$transaction(async (tx) => {
          const customer = await customerService.resolve(tx, {
            businessId: payment.businessId,
            name: payment.clientName,
            phone: payment.clientPhone,
            email: payment.clientEmail,
          });

          if (!customer) return false;

          await tx.payment.update({
            where: { id: payment.id },
            data: { customerId: customer.id },
          });
          return true;
        });
      },
    );
  }
}

export const customerBackfill = new CustomerBackfill();

import type { Prisma } from "@prisma/client";
import { cache } from "react";
import type { BookingDto, InvoiceDto, Page, ReceiptDto } from "types";

import {
  bookingListInclude,
  invoiceListInclude,
  receiptListInclude,
} from "@/backend/selects";
import { UNPAID_STATUSES } from "@/backend/services/dashboard";
import { db } from "@/server/db";
import type { BookingListParams, InvoiceListParams } from "@/utils/api";

/*
 * First pages for the list screens, in the same shape the API returns (same
 * includes, same page size, JSON round-tripped), so they can seed the
 * client's queries directly.
 */

export const PAGE_SIZE = 20;

function toPage<T>(rows: unknown[], total: number, page: number): Page<T> {
  return {
    data: JSON.parse(JSON.stringify(rows)) as T[],
    total,
    page,
    size: PAGE_SIZE,
    totalPages: Math.ceil(total / PAGE_SIZE),
  };
}

export const getBookingsPage = cache(
  async (businessId: string, params: BookingListParams): Promise<Page<BookingDto>> => {
    const page = params.page ?? 1;
    const where: Prisma.BookingWhereInput = { businessId };
    if (params.status) where.status = params.status;
    const [total, rows] = await Promise.all([
      db.booking.count({ where }),
      db.booking.findMany({
        where,
        include: bookingListInclude,
        orderBy: { startTime: params.sortOrder ?? "desc" },
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
      }),
    ]);
    return toPage(rows, total, page);
  },
);

export const getInvoicesPage = cache(
  async (businessId: string, params: InvoiceListParams): Promise<Page<InvoiceDto>> => {
    const page = params.page ?? 1;
    const where: Prisma.InvoiceWhereInput = { businessId };
    if (params.status) where.status = params.status;
    else if (params.unpaid) where.status = { in: UNPAID_STATUSES };
    const [total, rows] = await Promise.all([
      db.invoice.count({ where }),
      db.invoice.findMany({
        where,
        include: invoiceListInclude,
        orderBy: { createdAt: "desc" },
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
      }),
    ]);
    return toPage(rows, total, page);
  },
);

export const getReceiptsPage = cache(
  async (businessId: string, page: number): Promise<Page<ReceiptDto>> => {
    const where: Prisma.ReceiptWhereInput = { businessId };
    const [total, rows] = await Promise.all([
      db.receipt.count({ where }),
      db.receipt.findMany({
        where,
        include: receiptListInclude,
        orderBy: { createdAt: "desc" },
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
      }),
    ]);
    return toPage(rows, total, page);
  },
);

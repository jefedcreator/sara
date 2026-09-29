import {
  createSearchParamsCache,
  parseAsInteger,
  parseAsStringLiteral,
} from "nuqs/server";

import type { BookingListParams, InvoiceListParams } from "./api";

/*
 * List filters and pages live in the URL (shareable, survive a refresh). The
 * same parsers serve the client (useQueryStates) and the server page (cache).
 */

export const BOOKING_VIEWS = ["confirmed", "pending", "completed", "cancelled", "all"] as const;
export type BookingView = (typeof BOOKING_VIEWS)[number];

export const bookingsParams = {
  view: parseAsStringLiteral(BOOKING_VIEWS).withDefault("confirmed"),
  page: parseAsInteger.withDefault(1),
};
export const bookingsParamsCache = createSearchParamsCache(bookingsParams);

/** Open work reads soonest first; history reads newest first. */
export function bookingListParams(view: BookingView, page: number): BookingListParams {
  switch (view) {
    case "confirmed":
      return { status: "CONFIRMED", sortOrder: "asc", page };
    case "pending":
      return { status: "PENDING", sortOrder: "asc", page };
    case "completed":
      return { status: "COMPLETED", sortOrder: "desc", page };
    case "cancelled":
      return { status: "CANCELLED", sortOrder: "desc", page };
    default:
      return { sortOrder: "desc", page };
  }
}

export const INVOICE_VIEWS = ["unpaid", "paid", "draft", "void", "all"] as const;
export type InvoiceView = (typeof INVOICE_VIEWS)[number];

export const invoicesParams = {
  view: parseAsStringLiteral(INVOICE_VIEWS).withDefault("unpaid"),
  page: parseAsInteger.withDefault(1),
};
export const invoicesParamsCache = createSearchParamsCache(invoicesParams);

export function invoiceListParams(view: InvoiceView, page: number): InvoiceListParams {
  switch (view) {
    case "unpaid":
      return { unpaid: true, page };
    case "paid":
      return { status: "PAID", page };
    case "draft":
      return { status: "DRAFT", page };
    case "void":
      return { status: "VOID", page };
    default:
      return { page };
  }
}

export const receiptsParams = {
  page: parseAsInteger.withDefault(1),
};
export const receiptsParamsCache = createSearchParamsCache(receiptsParams);

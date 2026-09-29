import type { Prisma } from "@prisma/client";

/**
 * The business fields safe to send back with an invoice or receipt. Never
 * `business: true`: that row also holds Google Calendar tokens, the Paystack
 * subaccount and bank details.
 */
export const publicBusinessSelect = {
  id: true,
  ownerId: true,
  name: true,
  slug: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  country: true,
  logoUrl: true,
  currency: true,
} satisfies Prisma.BusinessSelect;

/** What an invoice list row carries (GET /api/invoices and the invoices page). */
export const invoiceListInclude = {
  business: { select: publicBusinessSelect },
  payments: true,
  services: { include: { service: true } },
  booking: {
    select: { id: true, slug: true, clientName: true, startTime: true },
  },
  _count: { select: { payments: true } },
} satisfies Prisma.InvoiceInclude;

/** What a receipt list row carries (GET /api/receipts and the receipts page). */
export const receiptListInclude = {
  payment: {
    include: {
      invoice: { select: { id: true, slug: true, invoiceNumber: true } },
    },
  },
  business: { select: publicBusinessSelect },
  services: { include: { service: true } },
} satisfies Prisma.ReceiptInclude;

/** What a booking list row carries (GET /api/bookings and the bookings page). */
export const bookingListInclude = {
  service: {
    select: { id: true, name: true, slug: true, price: true, duration: true },
  },
} satisfies Prisma.BookingInclude;

import { cache } from "react";
import type { PublicServiceDto } from "types";

import { catalogService } from "@/backend/services/catalog";
import { db } from "@/server/db";

/** The booking page's first paint: a service and one day of slots. */
export const getPublicService = cache(
  async (slug: string, date: string): Promise<PublicServiceDto | null> =>
    catalogService.getPublicService(slug, { date }),
);

/**
 * What the post-checkout page may show about a booking: its state, when, and
 * for what. No contact details; the slug is only known to the payer.
 */
export const getBookingReceipt = cache(async (bookingSlug: string) => {
  const booking = await db.booking.findUnique({
    where: { slug: bookingSlug },
    select: {
      status: true,
      startTime: true,
      endTime: true,
      units: true,
      clientName: true,
      service: { select: { slug: true, name: true, bookingMode: true } },
      business: { select: { name: true } },
    },
  });
  if (!booking) return null;
  return {
    status: booking.status,
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
    units: booking.units,
    bookingMode: booking.service.bookingMode,
    clientName: booking.clientName,
    serviceSlug: booking.service.slug,
    serviceName: booking.service.name,
    businessName: booking.business.name,
  };
});

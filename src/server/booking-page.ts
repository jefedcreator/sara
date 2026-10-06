import { cache } from "react";

import { db } from "@/server/db";
import type { PublicBooking } from "@/utils/booking-view";
import { publicPath } from "@/utils/public-links";

/**
 * The booking behind a customer's link, or null for an unknown id. A paused
 * or renamed service still shows: the booking is the customer's either way.
 * Never reads a phone number or an email address.
 */
export const getPublicBooking = cache(
  async (publicId: string): Promise<PublicBooking | null> => {
    const booking = await db.booking.findUnique({
      where: { publicId },
      select: {
        publicId: true,
        status: true,
        startTime: true,
        endTime: true,
        units: true,
        holdExpiresAt: true,
        amount: true,
        clientName: true,
        service: { select: { slug: true, name: true, bookingMode: true } },
        business: {
          select: { name: true, currency: true, address: true, city: true, state: true },
        },
        payments: {
          where: { receipt: { isNot: null } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { receipt: { select: { publicId: true } } },
        },
      },
    });
    if (!booking) return null;

    const receipt = booking.payments[0]?.receipt;
    // Blank parts (" ") are dropped, as the reminder email does.
    const address = [booking.business.address, booking.business.city, booking.business.state]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(", ");

    return {
      publicId: booking.publicId,
      status: booking.status,
      startTime: booking.startTime.toISOString(),
      endTime: booking.endTime.toISOString(),
      units: booking.units,
      holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
      amount: Number(booking.amount),
      currency: booking.business.currency,
      clientName: booking.clientName,
      service: booking.service,
      businessName: booking.business.name,
      businessAddress: address || null,
      receiptPath: receipt ? publicPath("receipt", receipt.publicId) : null,
    };
  },
);

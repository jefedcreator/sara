import { paystackService } from "@/backend/services/paystack";
import { db } from "@/server/db";
import { BadRequestException, ConflictException, NotFoundException } from "@/utils/exceptions";
import { appBaseUrl } from "@/utils/url";
import { Prisma, type Booking } from "@prisma/client";
import slugify from "slugify";

import { blockingBookingsWhere, holdExpiresFrom, isSerializationFailure } from "./conflicts";
import { bookingTerms } from "./terms";

export type CreateBookingInput = {
  serviceId?: string;
  serviceSlug?: string;
  startTime: Date;
  /** Slot services only; when given it must equal startTime + duration. */
  endTime?: Date;
  /** Nights (NIGHTLY) or days (DAILY). Ignored for slot services. */
  units?: number;
  clientName: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  notes?: string | null;
  payerEmailFallback?: string | null;
  /** Where Paystack sends the payer after checkout, built from the new booking. */
  callbackUrl?: (booking: Booking) => string;
};

export type BookingWithPayment = {
  booking: Booking;
  paymentUrl: string;
  paymentReference: string;
};

const SLOT_TAKEN = "This time slot is already booked. Please select a different slot.";
const DATES_TAKEN = "Those dates were just taken. Pick different dates.";

class BookingService {
  async createWithPayment(input: CreateBookingInput): Promise<BookingWithPayment> {
    if (!input.serviceId && !input.serviceSlug) {
      throw new BadRequestException("A serviceId or serviceSlug is required");
    }

    const businessSelect = {
      business: { select: { id: true, name: true, paystackSubaccountCode: true, currency: true } },
    } as const;

    const service = input.serviceId
      ? await db.service.findUnique({ where: { id: input.serviceId }, include: businessSelect })
      : await db.service.findFirst({ where: { slug: input.serviceSlug }, include: businessSelect });

    if (!service) throw new NotFoundException("Service not found");
    if (!service.isActive) {
      throw new BadRequestException("This service is currently unavailable for booking");
    }
    if (!service.business.paystackSubaccountCode) {
      throw new BadRequestException(
        "This business has not set up payment processing. Please contact the service provider.",
      );
    }

    const terms = bookingTerms(service, input.startTime, input.units ?? 1);
    if (service.bookingMode === "SLOT" && input.endTime && input.endTime.getTime() !== terms.endTime.getTime()) {
      const slotMinutes = (input.endTime.getTime() - input.startTime.getTime()) / (60 * 1000);
      throw new BadRequestException(
        `Slot duration (${slotMinutes} min) does not match service duration (${service.duration} min)`,
      );
    }

    const range = { start: input.startTime, end: terms.endTime };
    const takenMessage = service.bookingMode === "SLOT" ? SLOT_TAKEN : DATES_TAKEN;

    // Check and insert in one serializable transaction, so two customers
    // paying for the same time at the same moment can't both get through.
    const insert = () =>
      db.$transaction(
        async (tx) => {
          const now = new Date();
          const overlapping = await tx.booking.findFirst({
            where: blockingBookingsWhere(service, range, { now }),
            select: { id: true },
          });
          if (overlapping) throw new ConflictException(takenMessage);

          let slug = slugify(`${service.name}-${input.clientName}-${Date.now()}`, { lower: true, strict: true });
          for (let attempts = 0; attempts < 10; attempts++) {
            const existing = await tx.booking.findUnique({ where: { slug } });
            if (!existing) break;
            slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
          }

          const data: Prisma.BookingCreateInput = {
            slug,
            business: { connect: { id: service.business.id } },
            service: { connect: { id: service.id } },
            startTime: input.startTime,
            endTime: terms.endTime,
            units: terms.units,
            amount: terms.amount,
            holdExpiresAt: holdExpiresFrom(now),
            clientName: input.clientName,
            clientEmail: input.clientEmail ?? null,
            clientPhone: input.clientPhone ?? null,
            notes: input.notes ?? null,
            status: "PENDING",
          };
          return tx.booking.create({ data });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

    let booking: Booking;
    try {
      booking = await insert();
    } catch (error) {
      if (!isSerializationFailure(error)) throw error;
      try {
        booking = await insert();
      } catch (retryError) {
        if (isSerializationFailure(retryError)) throw new ConflictException(takenMessage);
        throw retryError;
      }
    }

    const payerEmail = input.clientEmail || input.payerEmailFallback || "customer@sara.app";
    const transaction = await paystackService.initializeTransaction({
      email: payerEmail,
      amount: Math.round(terms.amount.mul(100).toNumber()),
      subaccountCode: service.business.paystackSubaccountCode,
      callbackUrl:
        input.callbackUrl?.(booking) ??
        `${appBaseUrl()}/api/webhooks/paystack?b=${encodeURIComponent(booking.slug)}`,
      metadata: {
        bookingId: booking.id,
        bookingSlug: booking.slug,
        serviceId: service.id,
        serviceName: service.name,
        businessId: service.business.id,
        businessName: service.business.name,
        clientName: input.clientName,
        units: terms.units,
      },
      bearer: "account",
    });

    return { booking, paymentUrl: transaction.authorization_url, paymentReference: transaction.reference };
  }
}

export const bookingService = new BookingService();

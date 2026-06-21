import { paystackService } from "@/backend/services/paystack";
import { db } from "@/server/db";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";
import { type Booking, type Prisma } from "@prisma/client";
import slugify from "slugify";

export type CreateBookingInput = {
  serviceId?: string;
  serviceSlug?: string;
  startTime: Date;
  endTime: Date;
  clientName: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  notes?: string | null;
  payerEmailFallback?: string | null;
};

export type BookingWithPayment = {
  booking: Booking;
  paymentUrl: string;
  paymentReference: string;
};

class BookingService {
  async createWithPayment(
    input: CreateBookingInput,
  ): Promise<BookingWithPayment> {
    if (!input.serviceId && !input.serviceSlug) {
      throw new BadRequestException("A serviceId or serviceSlug is required");
    }

    const businessSelect = {
      business: {
        select: {
          id: true,
          name: true,
          paystackSubaccountCode: true,
          currency: true,
        },
      },
    } as const;

    const service = input.serviceId
      ? await db.service.findUnique({
          where: { id: input.serviceId },
          include: businessSelect,
        })
      : await db.service.findFirst({
          where: { slug: input.serviceSlug },
          include: businessSelect,
        });

    if (!service) throw new NotFoundException("Service not found");
    if (!service.isActive) {
      throw new BadRequestException(
        "This service is currently unavailable for booking",
      );
    }
    if (!service.business.paystackSubaccountCode) {
      throw new BadRequestException(
        "This business has not set up payment processing. Please contact the service provider.",
      );
    }

    const startTime = input.startTime;
    const endTime = input.endTime;
    if (startTime >= endTime) {
      throw new BadRequestException("startTime must be before endTime");
    }
    if (startTime < new Date()) {
      throw new BadRequestException("Cannot book a slot in the past");
    }
    const slotMinutes = (endTime.getTime() - startTime.getTime()) / (60 * 1000);
    if (slotMinutes !== service.duration) {
      throw new BadRequestException(
        `Slot duration (${slotMinutes} min) does not match service duration (${service.duration} min)`,
      );
    }

    const overlapping = await db.booking.findFirst({
      where: {
        businessId: service.business.id,
        status: { in: ["PENDING", "CONFIRMED"] },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        "This time slot is already booked. Please select a different slot.",
      );
    }

    const booking = await db.$transaction(async (tx) => {
      let slug = slugify(`${service.name}-${input.clientName}-${Date.now()}`, {
        lower: true,
        strict: true,
      });
      let attempts = 0;
      while (attempts < 10) {
        const existing = await tx.booking.findUnique({ where: { slug } });
        if (!existing) break;
        slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
        attempts++;
      }

      const data: Prisma.BookingCreateInput = {
        slug,
        business: { connect: { id: service.business.id } },
        service: { connect: { id: service.id } },
        startTime,
        endTime,
        clientName: input.clientName,
        clientEmail: input.clientEmail ?? null,
        clientPhone: input.clientPhone ?? null,
        notes: input.notes ?? null,
        status: "PENDING",
      };
      return tx.booking.create({ data });
    });

    const amountInSmallestUnit = Math.round(Number(service.price) * 100);
    const payerEmail =
      input.clientEmail || input.payerEmailFallback || "customer@sara.app";

    const transaction = await paystackService.initializeTransaction({
      email: payerEmail,
      amount: amountInSmallestUnit,
      subaccountCode: service.business.paystackSubaccountCode,
      metadata: {
        bookingId: booking.id,
        bookingSlug: booking.slug,
        serviceId: service.id,
        serviceName: service.name,
        businessId: service.business.id,
        businessName: service.business.name,
        clientName: input.clientName,
      },
      bearer: "account",
    });

    return {
      booking,
      paymentUrl: transaction.authorization_url,
      paymentReference: transaction.reference,
    };
  }
}

export const bookingService = new BookingService();

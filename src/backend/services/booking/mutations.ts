import { withSerializable } from "@/backend/services/assistant/transaction";
import type { Effect } from "@/backend/services/assistant/types";
import { emailService } from "@/backend/services/email";
import { googleCalendarService } from "@/backend/services/googleCalendar";
import type { UpdateBookingValidatorSchema } from "@/backend/validators/booking.validator";
import { db } from "@/server/db";
import { publicLink } from "@/server/share";
import { BadRequestException, ConflictException, NotFoundException } from "@/utils/exceptions";
import type { Prisma, Booking } from "@prisma/client";

import { blockingBookingsWhere } from "./conflicts";
import { bookingTerms } from "./terms";

const VALID_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

class BookingMutations {
  /** The caller must use a serializable transaction when changing booking time. */
  async updateInTransaction(
    tx: Prisma.TransactionClient,
    businessId: string,
    slug: string,
    patch: UpdateBookingValidatorSchema,
  ): Promise<{ booking: Booking; effects: Effect[] }> {
    const booking = await tx.booking.findFirst({
      where: { slug, businessId },
      include: { service: true },
    });
    if (!booking || booking.service.businessId !== businessId) {
      throw new NotFoundException("Booking not found");
    }
    if (patch.status && !VALID_STATUS_TRANSITIONS[booking.status]?.includes(patch.status)) {
      throw new BadRequestException(`Cannot transition booking from ${booking.status} to ${patch.status}`);
    }

    const data: Prisma.BookingUpdateInput = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.clientName !== undefined) data.clientName = patch.clientName;
    if (patch.clientEmail !== undefined) data.clientEmail = patch.clientEmail;
    if (patch.clientPhone !== undefined) data.clientPhone = patch.clientPhone;
    if (patch.notes !== undefined) data.notes = patch.notes;

    if (patch.startTime !== undefined || patch.endTime !== undefined) {
      const status = patch.status ?? booking.status;
      if (status !== "PENDING" && status !== "CONFIRMED") {
        throw new BadRequestException(`Cannot reschedule a ${status} booking`);
      }
      const startTime = patch.startTime ?? booking.startTime;
      const terms = bookingTerms(booking.service, startTime, booking.units, { enforceUnitLimits: false });
      if (booking.service.bookingMode === "SLOT" && patch.endTime && patch.endTime.getTime() !== terms.endTime.getTime()) {
        const minutes = (patch.endTime.getTime() - startTime.getTime()) / (60 * 1000);
        throw new BadRequestException(`Slot duration (${minutes} min) does not match service duration (${booking.service.duration} min)`);
      }
      const overlapping = await tx.booking.findFirst({
        where: blockingBookingsWhere(booking.service, { start: startTime, end: terms.endTime }, { excludeId: booking.id }),
        select: { id: true },
      });
      if (overlapping) {
        throw new ConflictException(booking.service.bookingMode === "SLOT"
          ? "This time slot is already booked. Please select a different slot."
          : "Those dates are already booked. Pick different dates.");
      }
      data.startTime = startTime;
      data.endTime = terms.endTime;
    }

    const updated = await tx.booking.update({ where: { id: booking.id }, data });
    const cancelled = booking.status !== "CANCELLED" && updated.status === "CANCELLED";
    const rescheduled = updated.status !== "CANCELLED" && (
      updated.startTime.getTime() !== booking.startTime.getTime() ||
      updated.endTime.getTime() !== booking.endTime.getTime()
    );
    return {
      booking: updated,
      effects: cancelled || rescheduled ? [{
        kind: "booking_sync",
        id: updated.id,
        previousStartTime: booking.startTime.toISOString(),
        previousEndTime: booking.endTime.toISOString(),
      }] : [],
    };
  }

  async update(businessId: string, slug: string, patch: UpdateBookingValidatorSchema): Promise<Booking> {
    const result = await withSerializable((tx) => this.updateInTransaction(tx, businessId, slug, patch));
    for (const effect of result.effects) {
      try {
        await this.finalize(effect);
      } catch (error) {
        console.warn("[Bookings] Sync failed:", error);
      }
    }
    return result.booking;
  }

  async finalize(effect: Effect): Promise<void> {
    if (effect.kind !== "booking_sync") return;
    // Reload after commit; never retain an expired transaction or calendar credentials in effects.
    const booking = await db.booking.findUnique({
      where: { id: effect.id },
      include: { business: true, service: true },
    });
    if (!booking) return;
    const cancelled = booking.status === "CANCELLED";
    const previousStartTime = effect.previousStartTime ? new Date(effect.previousStartTime) : booking.startTime;
    const previousEndTime = effect.previousEndTime ? new Date(effect.previousEndTime) :
      new Date(previousStartTime.getTime() + booking.endTime.getTime() - booking.startTime.getTime());
    const rescheduled = !cancelled && (booking.startTime.getTime() !== previousStartTime.getTime() || booking.endTime.getTime() !== previousEndTime.getTime());
    if (booking.clientEmail) {
      try {
        const span = { bookingMode: booking.service.bookingMode, endTime: booking.endTime, units: booking.units };
        if (cancelled) {
          await emailService.sendBookingCancellationEmail({
            to: booking.clientEmail, business: booking.business,
            serviceName: booking.service.name, serviceSlug: booking.service.slug,
            startTime: booking.startTime, span,
          });
        } else if (rescheduled) {
          await emailService.sendBookingRescheduledEmail({
            to: booking.clientEmail, business: booking.business, serviceName: booking.service.name,
            previousStartTime, newStartTime: booking.startTime,
            bookingUrl: publicLink("booking", booking.publicId), span,
            previousSpan: { bookingMode: booking.service.bookingMode, endTime: previousEndTime, units: booking.units },
          });
        }
      } catch (error) {
        console.warn("[Bookings] Notification email failed:", error);
      }
    }
    if (booking.googleEventId) {
      try {
        if (cancelled) {
          await googleCalendarService.deleteEvent(booking.business, booking.googleEventId);
          await db.booking.update({ where: { id: booking.id }, data: { googleEventId: null } });
        } else if (rescheduled) {
          await googleCalendarService.updateEvent(booking.business, booking, booking.service);
        }
      } catch (error) {
        console.warn("[Bookings] Calendar sync failed:", error);
      }
    }
  }
}

export const bookingMutations = new BookingMutations();

import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { blockingBookingsWhere } from "@/backend/services/booking/conflicts";
import { bookingTerms } from "@/backend/services/booking/terms";
import { emailService } from "@/backend/services/email";
import { googleCalendarService } from "@/backend/services/googleCalendar";
import {
  updateBookingValidatorSchema,
  type UpdateBookingValidatorSchema,
} from "@/backend/validators/booking.validator";
import { db } from "@/server/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { type Booking, type Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import type { ApiResponse, IBooking } from "types";

/**
 * @pathParams slug
 * @description Retrieves a single booking by slug with its associated service details.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request, { params }) => {
    try {
      const user = request.user!;
      const { slug } = params;

      const booking = await db.booking.findUnique({
        where: { slug },
        include: {
          business: { select: { ownerId: true } },
          service: {
            select: {
              id: true,
              name: true,
              slug: true,
              price: true,
              duration: true,
              image: true,
            },
          },
        },
      });

      if (!booking) {
        throw new NotFoundException("Booking not found");
      }

      if (booking.business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You are not authorized to view this booking",
        );
      }

      const response: ApiResponse<IBooking> = {
        status: 200,
        message: "Booking retrieved successfully",
        data: booking,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching booking: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

/**
 * Valid status transitions for bookings.
 * Prevents invalid state changes (e.g. CANCELLED → CONFIRMED).
 */
const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * @body UpdateBookingValidatorSchema
 * @pathParams slug
 * @description Updates an existing booking. Supports status transitions,
 *              rescheduling (startTime/endTime), and client detail edits.
 *              Status transitions are validated against allowed state changes.
 * @contentType application/json
 * @auth bearer
 */
export const PUT = withMiddleware<UpdateBookingValidatorSchema>(
  async (request, { params }) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;
      const { slug } = params;

      const booking = await db.booking.findUnique({
        where: { slug },
        include: {
          business: {
            select: {
              id: true,
              ownerId: true,
              name: true,
              email: true,
              googleCalendarId: true,
              googleCalendarAccessToken: true,
              googleCalendarRefreshToken: true,
              googleCalendarTokenExpiry: true,
            },
          },
          service: {
            select: {
              id: true, businessId: true, bookingMode: true, price: true, duration: true,
              checkInTime: true, checkOutTime: true, minUnits: true, maxUnits: true,
              name: true, slug: true,
            },
          },
        },
      });

      if (!booking) {
        throw new NotFoundException("Booking not found");
      }

      if (booking.business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You are not authorized to update this booking",
        );
      }

      const previousStartTime = booking.startTime;

      // Validate status transition
      if (payload.status) {
        const allowed = VALID_STATUS_TRANSITIONS[booking.status];
        if (!allowed || !allowed.includes(payload.status)) {
          throw new BadRequestException(
            `Cannot transition booking from ${booking.status} to ${payload.status}`,
          );
        }
      }

      const updatedBooking = await db.$transaction(async (tx) => {
        const data: Prisma.BookingUpdateInput = {};

        if (payload.status !== undefined) data.status = payload.status;
        if (payload.clientName !== undefined)
          data.clientName = payload.clientName;
        if (payload.clientEmail !== undefined)
          data.clientEmail = payload.clientEmail;
        if (payload.clientPhone !== undefined)
          data.clientPhone = payload.clientPhone;
        if (payload.notes !== undefined) data.notes = payload.notes;

        // Handle rescheduling (startTime and/or endTime)
        if (payload.startTime !== undefined || payload.endTime !== undefined) {
          // Only PENDING or CONFIRMED bookings can be rescheduled
          const currentStatus = payload.status ?? booking.status;
          if (currentStatus !== "PENDING" && currentStatus !== "CONFIRMED") {
            throw new BadRequestException(
              `Cannot reschedule a ${currentStatus} booking`,
            );
          }

          const newStartTime = payload.startTime ? new Date(payload.startTime) : booking.startTime;

          // Same length as booked, so the amount already paid stays right.
          const terms = bookingTerms(booking.service, newStartTime, booking.units, {
            enforceUnitLimits: false,
          });

          if (
            booking.service.bookingMode === "SLOT" &&
            payload.endTime &&
            new Date(payload.endTime).getTime() !== terms.endTime.getTime()
          ) {
            const slotMinutes = (new Date(payload.endTime).getTime() - newStartTime.getTime()) / (60 * 1000);
            throw new BadRequestException(
              `Slot duration (${slotMinutes} min) does not match service duration (${booking.service.duration} min)`,
            );
          }

          const overlapping = await tx.booking.findFirst({
            where: blockingBookingsWhere(
              booking.service,
              { start: newStartTime, end: terms.endTime },
              { excludeId: booking.id },
            ),
            select: { id: true },
          });
          if (overlapping) {
            throw new ConflictException(
              booking.service.bookingMode === "SLOT"
                ? "This time slot is already booked. Please select a different slot."
                : "Those dates are already booked. Pick different dates.",
            );
          }

          data.startTime = newStartTime;
          data.endTime = terms.endTime;
        }

        return await tx.booking.update({
          where: { id: booking.id },
          data,
        });
      });

      // Best-effort: a failed notification/Calendar sync must never fail
      // the update itself.
      const isNowCancelled = updatedBooking.status === "CANCELLED";
      const wasRescheduled =
        !isNowCancelled &&
        updatedBooking.startTime.getTime() !== previousStartTime.getTime();

      const clientEmail = updatedBooking.clientEmail;
      if (clientEmail) {
        try {
          if (isNowCancelled) {
            await emailService.sendBookingCancellationEmail({
              to: clientEmail,
              business: booking.business,
              serviceName: booking.service.name,
              serviceSlug: booking.service.slug,
              startTime: updatedBooking.startTime,
            });
          } else if (wasRescheduled) {
            await emailService.sendBookingRescheduledEmail({
              to: clientEmail,
              business: booking.business,
              serviceName: booking.service.name,
              previousStartTime,
              newStartTime: updatedBooking.startTime,
            });
          }
        } catch (err) {
          console.warn("[Bookings] Notification email failed:", err);
        }
      }

      if (updatedBooking.googleEventId) {
        try {
          if (isNowCancelled) {
            await googleCalendarService.deleteEvent(
              booking.business,
              updatedBooking.googleEventId,
            );
            await db.booking.update({
              where: { id: updatedBooking.id },
              data: { googleEventId: null },
            });
          } else if (wasRescheduled) {
            await googleCalendarService.updateEvent(
              booking.business,
              updatedBooking,
              booking.service,
            );
          }
        } catch (err) {
          console.warn("[Bookings] Calendar sync failed:", err);
        }
      }

      const response: ApiResponse<Booking> = {
        status: 200,
        message: "Booking updated successfully",
        data: updatedBooking,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while updating booking: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(updateBookingValidatorSchema)],
);

/**
 * @pathParams slug
 * @description Cancels a booking by transitioning its status to CANCELLED.
 *              Only PENDING or CONFIRMED bookings can be cancelled.
 * @auth bearer
 */
export const DELETE = withMiddleware<unknown>(
  async (request, { params }) => {
    try {
      const user = request.user!;
      const { slug } = params;

      const booking = await db.booking.findUnique({
        where: { slug },
        include: {
          business: {
            select: {
              id: true,
              ownerId: true,
              name: true,
              email: true,
              googleCalendarId: true,
              googleCalendarAccessToken: true,
              googleCalendarRefreshToken: true,
              googleCalendarTokenExpiry: true,
            },
          },
          service: { select: { name: true, slug: true } },
        },
      });

      if (!booking) {
        throw new NotFoundException("Booking not found");
      }

      if (booking.business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You are not authorized to cancel this booking",
        );
      }

      if (booking.status === "COMPLETED") {
        throw new BadRequestException("Cannot cancel a completed booking");
      }

      if (booking.status === "CANCELLED") {
        throw new BadRequestException("Booking is already cancelled");
      }

      const cancelledBooking = await db.booking.update({
        where: { id: booking.id },
        data: { status: "CANCELLED" },
      });

      // Best-effort: a failed notification must never fail the cancellation.
      if (booking.clientEmail) {
        try {
          await emailService.sendBookingCancellationEmail({
            to: booking.clientEmail,
            business: booking.business,
            serviceName: booking.service.name,
            serviceSlug: booking.service.slug,
            startTime: booking.startTime,
          });
        } catch (err) {
          console.warn("[Bookings] Cancellation email failed:", err);
        }
      }

      if (booking.googleEventId) {
        try {
          await googleCalendarService.deleteEvent(
            booking.business,
            booking.googleEventId,
          );
          await db.booking.update({
            where: { id: booking.id },
            data: { googleEventId: null },
          });
        } catch (err) {
          console.warn("[Bookings] Calendar sync failed:", err);
        }
      }

      const response: ApiResponse<Booking> = {
        status: 200,
        message: "Booking cancelled successfully",
        data: cancelledBooking,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while cancelling booking: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

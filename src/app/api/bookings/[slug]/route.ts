import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { emailService } from "@/backend/services/email";
import { googleCalendarService } from "@/backend/services/googleCalendar";
import {
  updateBookingValidatorSchema,
  type UpdateBookingValidatorSchema,
} from "@/backend/validators/booking.validator";
import { db } from "@/server/db";
import {
  BadRequestException,
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
              googleCalendarId: true,
              googleCalendarAccessToken: true,
              googleCalendarRefreshToken: true,
              googleCalendarTokenExpiry: true,
            },
          },
          service: { select: { duration: true, name: true } },
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

          const newStartTime = payload.startTime
            ? new Date(payload.startTime)
            : booking.startTime;
          const newEndTime = payload.endTime
            ? new Date(payload.endTime)
            : booking.endTime;

          if (newStartTime >= newEndTime) {
            throw new BadRequestException("startTime must be before endTime");
          }

          if (newStartTime < new Date()) {
            throw new BadRequestException("Cannot reschedule to a past slot");
          }

          // Verify slot duration matches service duration
          const slotDurationMinutes =
            (newEndTime.getTime() - newStartTime.getTime()) / (60 * 1000);
          if (slotDurationMinutes !== booking.service.duration) {
            throw new BadRequestException(
              `Slot duration (${slotDurationMinutes} min) does not match service duration (${booking.service.duration} min)`,
            );
          }

          // Check for overlapping bookings (exclude the current booking).
          // Scoped by businessId, not serviceId — one business is one
          // provider with one calendar.
          const overlapping = await tx.booking.findFirst({
            where: {
              businessId: booking.businessId,
              id: { not: booking.id },
              status: { in: ["PENDING", "CONFIRMED"] },
              startTime: { lt: newEndTime },
              endTime: { gt: newStartTime },
            },
          });

          if (overlapping) {
            throw new BadRequestException(
              "This time slot is already booked. Please select a different slot.",
            );
          }

          data.startTime = newStartTime;
          data.endTime = newEndTime;
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
              businessName: booking.business.name,
              serviceName: booking.service.name,
              startTime: updatedBooking.startTime,
            });
          } else if (wasRescheduled) {
            await emailService.sendBookingRescheduledEmail({
              to: clientEmail,
              businessName: booking.business.name,
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
              googleCalendarId: true,
              googleCalendarAccessToken: true,
              googleCalendarRefreshToken: true,
              googleCalendarTokenExpiry: true,
            },
          },
          service: { select: { name: true } },
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
            businessName: booking.business.name,
            serviceName: booking.service.name,
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

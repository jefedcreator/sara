import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { bookingMutations } from "@/backend/services/booking/mutations";
import {
  updateBookingValidatorSchema,
  type UpdateBookingValidatorSchema,
} from "@/backend/validators/booking.validator";
import { db } from "@/server/db";
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { type Booking } from "@prisma/client";
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
      if (!slug) throw new NotFoundException("Booking not found");

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
      if (!slug) throw new NotFoundException("Booking not found");

      const business = user.business;
      if (!business) throw new NotFoundException("Business not found");
      if (business.ownerId !== user.id) throw new ForbiddenException("You are not authorized to update this booking");
      const updatedBooking = await bookingMutations.update(business.id, slug, payload);

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
      if (!slug) throw new NotFoundException("Booking not found");

      const business = user.business;
      if (!business) throw new NotFoundException("Business not found");
      if (business.ownerId !== user.id) throw new ForbiddenException("You are not authorized to cancel this booking");
      const cancelledBooking = await bookingMutations.update(business.id, slug, { status: "CANCELLED" });

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

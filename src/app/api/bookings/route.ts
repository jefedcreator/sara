import {
  authMiddleware,
  bodyValidatorMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { bookingListInclude } from "@/backend/selects";
import { atlasService } from "@/backend/services/atlas";
import { bookingService } from "@/backend/services/booking";
import {
  bookingQueryValidatorSchema,
  bookingValidatorSchema,
  type BookingQueryValidatorSchema,
  type BookingValidatorSchema,
} from "@/backend/validators/booking.validator";
import { db } from "@/server/db";
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { type Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import type { ApiResponse, CreatedBooking, PaginatedApiResponse } from "types";

/**
 * @body BookingValidatorSchema
 * @description Creates a new booking for a service and initializes a Paystack
 *              payment transaction. Returns the Paystack authorization URL for
 *              the client to complete payment.
 * @contentType application/json
 * @auth bearer
 */
export const POST = withMiddleware<BookingValidatorSchema>(
  async (request) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;

      const { booking, paymentUrl, paymentReference } =
        await bookingService.createWithPayment({
          serviceId: payload.serviceId,
          startTime: new Date(payload.startTime),
          endTime: new Date(payload.endTime),
          clientName: payload.clientName,
          clientEmail: payload.clientEmail,
          clientPhone: payload.clientPhone,
          notes: payload.notes,
          payerEmailFallback: user.email,
        });

      // Best-effort Atlas route enrichment (non-fatal).
      if (payload.clientLat != null && payload.clientLong != null) {
        const businessCoords = await db.business.findUnique({
          where: { id: booking.businessId },
          select: { latitude: true, longitude: true },
        });
        if (businessCoords?.latitude != null && businessCoords?.longitude != null) {
          try {
            const routeResult = await atlasService.route(
              { lat: payload.clientLat, lon: payload.clientLong },
              { lat: Number(businessCoords.latitude), lon: Number(businessCoords.longitude) },
              "car",
            );
            await db.booking.update({
              where: { id: booking.id },
              data: {
                clientLat: payload.clientLat,
                clientLong: payload.clientLong,
                distanceKm: routeResult.distance_m / 1000,
                durationMin: Math.ceil(routeResult.duration_s / 60),
                routePolyline: JSON.stringify(routeResult.geometry),
              },
            });
          } catch (routeError: any) {
            console.warn("Atlas routing failed:", routeError.message);
          }
        }
      }

      const response: ApiResponse<CreatedBooking> = {
        status: 201,
        message: "Booking created successfully. Complete payment to confirm.",
        data: { ...booking, paymentUrl, paymentReference },
      };

      return NextResponse.json(response, { status: 201 });
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while creating booking: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(bookingValidatorSchema)],
);

/**
 * @queryParams BookingQueryValidatorSchema
 * @description Retrieves bookings for the authenticated user's business.
 *              Supports search, pagination, and filtering by status or service.
 * @auth bearer
 */
export const GET = withMiddleware<unknown, BookingQueryValidatorSchema>(
  async (request) => {
    try {
      const payload = request.query!;
      const user = request.user!;
      const business = user.business;

      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      if (user.id !== business.ownerId) {
        throw new ForbiddenException(
          "You do not have permission to view bookings for this business",
        );
      }

      const where: Prisma.BookingWhereInput = {
        businessId: business.id,
      };

      if (payload.status) {
        where.status = payload.status;
      }

      if (payload.serviceId) {
        where.serviceId = payload.serviceId;
      }

      if (payload.query) {
        where.OR = [
          { clientName: { contains: payload.query, mode: "insensitive" } },
          { clientEmail: { contains: payload.query, mode: "insensitive" } },
          { slug: { contains: payload.query, mode: "insensitive" } },
        ];
      }

      const orderBy: Prisma.BookingOrderByWithRelationInput = {
        [payload.sortBy ?? "createdAt"]: payload.sortOrder ?? "desc",
      };

      if (payload.all) {
        const data = await db.booking.findMany({
          where,
          orderBy,
          include: bookingListInclude,
        });

        const response: PaginatedApiResponse<typeof data> = {
          status: 200,
          message: "Bookings retrieved successfully",
          data,
          total: data.length,
          page: 1,
          size: data.length || 1,
          totalPages: 1,
        };

        return NextResponse.json(response);
      }

      const page = payload.page ?? 1;
      const size = payload.size ?? 10;
      const skip = (page - 1) * size;

      const [count, data] = await Promise.all([
        db.booking.count({ where }),
        db.booking.findMany({
          where,
          take: size,
          skip,
          orderBy,
          include: bookingListInclude,
        }),
      ]);

      const response: PaginatedApiResponse<typeof data> = {
        status: 200,
        message: "Bookings retrieved successfully",
        data,
        total: count,
        page,
        size,
        totalPages: Math.ceil(count / size),
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching bookings: ${error.message}`,
      );
    }
  },
  [authMiddleware, queryValidatorMiddleware(bookingQueryValidatorSchema)],
);

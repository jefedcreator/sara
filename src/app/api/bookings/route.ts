import {
  authMiddleware,
  bodyValidatorMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { atlasService } from "@/backend/services/atlas";
import { paystackService } from "@/backend/services/paystack";
import {
  bookingQueryValidatorSchema,
  bookingValidatorSchema,
  type BookingQueryValidatorSchema,
  type BookingValidatorSchema,
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
import slugify from "slugify";
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

      // 1. Fetch the service with its business (including subaccount info)
      const service = await db.service.findUnique({
        where: { id: payload.serviceId },
        include: {
          business: {
            select: {
              id: true,
              ownerId: true,
              name: true,
              paystackSubaccountCode: true,
              currency: true,
            },
          },
        },
      });

      if (!service) {
        throw new NotFoundException("Service not found");
      }

      if (!service.isActive) {
        throw new BadRequestException(
          "This service is currently unavailable for booking",
        );
      }

      // 2. Validate the business has a Paystack subaccount for split payments
      if (!service.business.paystackSubaccountCode) {
        throw new BadRequestException(
          "This business has not set up payment processing. Please contact the service provider.",
        );
      }

      // 3. Validate the time slot
      const startTime = new Date(payload.startTime);
      const endTime = new Date(payload.endTime);

      if (startTime >= endTime) {
        throw new BadRequestException("startTime must be before endTime");
      }

      if (startTime < new Date()) {
        throw new BadRequestException("Cannot book a slot in the past");
      }

      // Verify the slot duration matches the service duration
      const slotDurationMinutes =
        (endTime.getTime() - startTime.getTime()) / (60 * 1000);
      if (slotDurationMinutes !== service.duration) {
        throw new BadRequestException(
          `Slot duration (${slotDurationMinutes} min) does not match service duration (${service.duration} min)`,
        );
      }

      // 4. Check for overlapping bookings (PENDING or CONFIRMED). Scoped by
      // businessId, not serviceId — one business is one provider with one
      // calendar, so a booking on any service blocks the same time slot.
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

      // 5. Create the booking within a transaction
      const booking = await db.$transaction(async (tx) => {
        // Generate a unique slug
        let slug = slugify(
          `${service.name}-${payload.clientName}-${Date.now()}`,
          { lower: true, strict: true },
        );

        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
          const existing = await tx.booking.findUnique({
            where: { slug },
          });
          if (!existing) {
            isUnique = true;
          } else {
            slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
            attempts++;
          }
        }

        const data: Prisma.BookingCreateInput = {
          slug,
          business: { connect: { id: service.business.id } },
          service: { connect: { id: service.id } },
          startTime,
          endTime,
          clientName: payload.clientName,
          clientEmail: payload.clientEmail,
          clientPhone: payload.clientPhone,
          notes: payload.notes,
          status: "PENDING",
        };

        return await tx.booking.create({ data });
      });

      // 5b. Compute Atlas route if client + business coordinates are available
      const businessCoords = await db.business.findUnique({
        where: { id: service.business.id },
        select: { latitude: true, longitude: true },
      });

      if (
        payload.clientLat != null &&
        payload.clientLong != null &&
        businessCoords?.latitude != null &&
        businessCoords?.longitude != null
      ) {
        try {
          const routeResult = await atlasService.route(
            { lat: payload.clientLat, lon: payload.clientLong },
            {
              lat: Number(businessCoords.latitude),
              lon: Number(businessCoords.longitude),
            },
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
          // Routing failure is non-fatal — booking is still created without route data
          console.warn("Atlas routing failed:", routeError.message);
        }
      }

      // 6. Initialize Paystack transaction with split payment
      const amountInSmallestUnit = Math.round(
        Number(service.price) * 100,
      );

      const clientEmail =
        payload.clientEmail || user.email || "customer@sara.app";

      const paystackTransaction = await paystackService.initializeTransaction({
        email: clientEmail,
        amount: amountInSmallestUnit,
        subaccountCode: service.business.paystackSubaccountCode,
        metadata: {
          bookingId: booking.id,
          bookingSlug: booking.slug,
          serviceId: service.id,
          serviceName: service.name,
          businessId: service.business.id,
          businessName: service.business.name,
          clientName: payload.clientName,
        },
        bearer: "account",
      });

      const response: ApiResponse<CreatedBooking> = {
        status: 201,
        message: "Booking created successfully. Complete payment to confirm.",
        data: {
          ...booking,
          paymentUrl: paystackTransaction.authorization_url,
          paymentReference: paystackTransaction.reference,
        },
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
          include: {
            service: { select: { id: true, name: true, slug: true, price: true, duration: true } },
          },
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
          include: {
            service: { select: { id: true, name: true, slug: true, price: true, duration: true } },
          },
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

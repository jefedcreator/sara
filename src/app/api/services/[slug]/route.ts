import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { cloudinaryService } from "@/backend/services/cloudinary";
import {
  updateServiceValidatorSchema,
  type UpdateServiceValidatorSchema,
} from "@/backend/validators/service.validator";
import { db } from "@/server/db";
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { type Service, type Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import slugify from "slugify";
import type { ApiResponse, ServiceDetail, TimeSlot } from "types";

/**
 * @body UpdateServiceValidatorSchema
 * @pathParams slugParamValidator
 * @description Updates an existing service for the authenticated user's business.
 * @contentType application/json
 * @auth bearer
 */
export const PUT = withMiddleware<UpdateServiceValidatorSchema>(
  async (request, { params }) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;
      const { slug } = params;
      const business = user.business;

      const service = await db.service.findUnique({
        where: { slug },
        include: { business: { select: { ownerId: true, name: true } } },
      });

      if (!business) {
        throw new NotFoundException("Business not found");
      }

      if (!service) {
        throw new NotFoundException("Service not found");
      }

      if (service.business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You are not authorized to update this service",
        );
      }

      const updatedService = await db.$transaction(async (tx) => {
        const data: Prisma.ServiceUpdateInput = {};

        if (payload.name) {
          data.name = payload.name;

          let newSlug = slugify(`${service.business.name}-${payload.name}`, {
            lower: true,
            strict: true,
          });

          // Ensure uniqueness if slug actually changed
          if (newSlug !== service.slug) {
            let isUnique = false;
            let attempts = 0;
            while (!isUnique && attempts < 10) {
              const existing = await tx.service.findUnique({
                where: { slug: newSlug },
              });
              if (!existing) {
                isUnique = true;
              } else {
                newSlug = `${newSlug}-${Math.random().toString(36).substring(2, 7)}`;
                attempts++;
              }
            }
            data.slug = newSlug;
          }
        }

        if (payload.description !== undefined)
          data.description = payload.description;
        if (payload.image instanceof File) {
          const uploadResult = await cloudinaryService.uploadFile(
            payload.image,
            {
              folder: `sara/${business.id}/services`,
            },
          );
          data.image = uploadResult.secure_url;
        }
        if (payload.price !== undefined) data.price = payload.price;
        if (payload.duration !== undefined) data.duration = payload.duration;
        if (payload.availableFrom !== undefined)
          data.availableFrom = payload.availableFrom;
        if (payload.availableTo !== undefined)
          data.availableTo = payload.availableTo;
        if (payload.isActive !== undefined) data.isActive = payload.isActive;

        return await tx.service.update({
          where: { id: service.id },
          data,
        });
      });

      const response: ApiResponse<Service> = {
        status: 200,
        message: "Service updated successfully",
        data: updatedService,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while updating service: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(updateServiceValidatorSchema)],
);

/**
 * @pathParams slugParamValidator
 * @description Deletes or deactivates an existing service for the authenticated user's business.
 * @auth bearer
 */
export const DELETE = withMiddleware<unknown>(
  async (request, { params }) => {
    try {
      const user = request.user!;
      const { slug } = params;

      const service = await db.service.findUnique({
        where: { slug },
        include: {
          business: { select: { ownerId: true } },
          _count: {
            select: {
              bookings: true,
              invoices: true,
              receipts: true,
            },
          },
        },
      });

      if (!service) {
        throw new NotFoundException("Service not found");
      }

      if (service.business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You are not authorized to delete this service",
        );
      }

      let deletedOrDeactivated: Service;
      let isSoftDelete = false;

      // If linked to active/historical transactions, soft delete by deactivating
      if (
        service._count.bookings > 0 ||
        service._count.invoices > 0 ||
        service._count.receipts > 0
      ) {
        isSoftDelete = true;
        deletedOrDeactivated = await db.service.update({
          where: { id: service.id },
          data: { isActive: false },
        });
      } else {
        deletedOrDeactivated = await db.service.delete({
          where: { id: service.id },
        });
      }

      const response: ApiResponse<Service> = {
        status: 200,
        message: isSoftDelete
          ? "Service deactivated successfully (soft-deleted due to existing bookings/billing history)"
          : "Service deleted successfully",
        data: deletedOrDeactivated,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while deleting service: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

/**
 * Generates all possible time slots for a given date based on the
 * service's availability window and duration.
 */
function generateTimeSlots(
  date: string,
  availableFrom: string,
  availableTo: string,
  durationMinutes: number,
): { startTime: Date; endTime: Date }[] {
  const slots: { startTime: Date; endTime: Date }[] = [];

  const dayStart = new Date(`${date}T${availableFrom}:00.000Z`);
  const dayEnd = new Date(`${date}T${availableTo}:00.000Z`);
  const durationMs = durationMinutes * 60 * 1000;

  let current = dayStart.getTime();

  while (current + durationMs <= dayEnd.getTime()) {
    slots.push({
      startTime: new Date(current),
      endTime: new Date(current + durationMs),
    });
    current += durationMs;
  }

  return slots;
}

/**
 * @pathParams slugParamValidator
 * @queryParams date (optional, YYYY-MM-DD, defaults to today)
 * @description Retrieves a single service by slug with computed available
 *              time slots for the requested date. Slots that overlap with
 *              existing PENDING or CONFIRMED bookings are marked as unavailable.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request, { params }) => {
    try {
      const user = request.user!;
      const { slug } = params;

      // Parse optional date query param (defaults to today)
      const url = new URL(request.url);
      const dateParam = url.searchParams.get("date");
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

      const targetDate =
        dateParam && dateRegex.test(dateParam)
          ? dateParam
          : new Date().toISOString().split("T")[0]!;

      const service = await db.service.findUnique({
        where: { slug },
        include: { business: { select: { ownerId: true } } },
      });

      if (!service) {
        throw new NotFoundException("Service not found");
      }

      if (service.business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You are not authorized to view this service",
        );
      }

      // Generate all possible slots for the target date
      const allSlots = generateTimeSlots(
        targetDate,
        service.availableFrom,
        service.availableTo,
        service.duration,
      );

      // Fetch active bookings for this service that fall on the target date
      const dayStart = new Date(`${targetDate}T00:00:00.000Z`);
      const dayEnd = new Date(`${targetDate}T23:59:59.999Z`);

      const existingBookings = await db.booking.findMany({
        where: {
          serviceId: service.id,
          status: { in: ["PENDING", "CONFIRMED"] },
          startTime: { lt: dayEnd },
          endTime: { gt: dayStart },
        },
        select: { startTime: true, endTime: true },
      });

      // Mark each slot's availability by checking for overlapping bookings
      const slots: TimeSlot[] = allSlots.map((slot) => {
        const isBooked = existingBookings.some(
          (booking) =>
            booking.startTime < slot.endTime &&
            booking.endTime > slot.startTime,
        );

        return {
          startTime: slot.startTime.toISOString(),
          endTime: slot.endTime.toISOString(),
          isAvailable: !isBooked,
        };
      });

      const response: ApiResponse<ServiceDetail> = {
        status: 200,
        message: "Service retrieved successfully",
        data: {
          ...service,
          slots,
        },
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching service: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);


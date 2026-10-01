import {
  authMiddleware,
  bodyValidatorMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { availabilityService } from "@/backend/services/availability";
import { cloudinaryService } from "@/backend/services/cloudinary";
import { activeBookingWhere } from "@/backend/services/booking/conflicts";
import {
  bookingSetupProblem,
  serviceDetailQueryValidatorSchema,
  updateServiceValidatorSchema,
  type ServiceDetailQueryValidatorSchema,
  type UpdateServiceValidatorSchema,
} from "@/backend/validators/service.validator";
import { db } from "@/server/db";
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { type Service, type Prisma } from "@prisma/client";
import { addDays } from "@/utils/format";
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

      const merged = {
        bookingMode: payload.bookingMode ?? service.bookingMode,
        checkInTime: payload.checkInTime !== undefined ? payload.checkInTime : service.checkInTime,
        checkOutTime: payload.checkOutTime !== undefined ? payload.checkOutTime : service.checkOutTime,
        minUnits: payload.minUnits ?? service.minUnits,
        maxUnits: payload.maxUnits ?? service.maxUnits,
      };
      const problem = bookingSetupProblem(merged);
      if (problem) throw new BadRequestException(problem);

      if (merged.bookingMode !== service.bookingMode) {
        const upcoming = await db.booking.count({
          where: { serviceId: service.id, endTime: { gt: new Date() }, AND: [activeBookingWhere()] },
        });
        if (upcoming > 0) throw new BadRequestException("Finish or cancel the upcoming bookings first.");
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
        if (payload.bookingMode !== undefined) data.bookingMode = payload.bookingMode;
        if (payload.checkInTime !== undefined) data.checkInTime = payload.checkInTime;
        if (payload.checkOutTime !== undefined) data.checkOutTime = payload.checkOutTime;
        if (payload.minUnits !== undefined) data.minUnits = payload.minUnits;
        if (payload.maxUnits !== undefined) data.maxUnits = payload.maxUnits;

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
 * @pathParams slugParamValidator
 * @queryParams ServiceDetailQueryValidatorSchema
 * @description Retrieves a single service by slug with computed available
 *              time slots for the requested date (defaults to today). Slots
 *              are excluded by business hours, closures, existing bookings
 *              across the whole business, and (if connected) Google Calendar.
 * @auth bearer
 */
export const GET = withMiddleware<unknown, ServiceDetailQueryValidatorSchema>(
  async (request, { params }) => {
    try {
      const user = request.user!;
      const { slug } = params;
      const targetDate =
        request.query?.date ?? new Date().toISOString().split("T")[0]!;

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

      const excluded = request.query?.exclude
        ? await db.booking.findFirst({
            where: { slug: request.query.exclude, serviceId: service.id },
            select: { id: true },
          })
        : null;
      const excludeBookingId = excluded?.id;

      let slots: TimeSlot[] = [];
      let nights: { date: string; isAvailable: boolean }[] = [];
      if (service.bookingMode === "NIGHTLY") {
        const from = request.query?.from ?? targetDate;
        const to = request.query?.to ?? addDays(from, 31);
        nights = await availabilityService.getNights({ serviceId: service.id, from, to, excludeBookingId });
      } else {
        const available =
          service.bookingMode === "DAILY"
            ? await availabilityService.getPickupTimes({
                serviceId: service.id,
                date: targetDate,
                units: request.query?.units ?? service.minUnits,
                excludeBookingId,
              })
            : await availabilityService.getAvailableSlots({
                businessId: service.businessId,
                serviceId: service.id,
                date: targetDate,
              });
        slots = available.map((slot) => ({
          startTime: slot.startTime.toISOString(),
          endTime: slot.endTime.toISOString(),
          isAvailable: slot.isAvailable,
        }));
      }

      const response: ApiResponse<ServiceDetail> = {
        status: 200,
        message: "Service retrieved successfully",
        data: {
          ...service,
          slots,
          nights,
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
  [authMiddleware, queryValidatorMiddleware(serviceDetailQueryValidatorSchema)],
);

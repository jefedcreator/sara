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
import type { ApiResponse } from "types";

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

        if (payload.description !== undefined) data.description = payload.description;
        if (payload.image instanceof File) {
          const uploadResult = await cloudinaryService.uploadFile(payload.image, {
            folder: `sara/${business.id}/services`,
          });
          data.image = uploadResult.secure_url;
        }
        if (payload.price !== undefined) data.price = payload.price;
        if (payload.duration !== undefined) data.duration = payload.duration;
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
 * @pathParams slugParamValidator
 * @description Retrieves a single service by slug for the authenticated user's business.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request, { params }) => {
    try {
      const user = request.user!;
      const { slug } = params;

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

      const response: ApiResponse<Service> = {
        status: 200,
        message: "Service retrieved successfully",
        data: service,
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

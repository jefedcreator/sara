import {
  authMiddleware,
  bodyValidatorMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { cloudinaryService } from "@/backend/services/cloudinary";
import {
  serviceQueryValidatorSchema,
  serviceValidatorSchema,
  type ServiceQueryValidatorSchema,
  type ServiceValidatorSchema,
} from "@/backend/validators/service.validator";
import { db } from "@/server/db";
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { Prisma, type Service } from "@prisma/client";
import { NextResponse } from "next/server";
import slugify from "slugify";
import type { ApiResponse, ServiceListItem, PaginatedApiResponse } from "types";

/**
 * @body ServiceValidatorSchema
 * @description Creates a new service for the user's business.
 * @contentType application/json
 * @auth bearer
 */
export const POST = withMiddleware<ServiceValidatorSchema>(
  async (request) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;
      const business = user.business;

      if (!business) {
        throw new NotFoundException("Business not found");
      }

      if (business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You do not have permission to manage services for this business",
        );
      }

      const serviceResult = await db.$transaction(async (tx) => {
        let slug = slugify(`${payload.name}`, {
          lower: true,
          strict: true,
        });

        // Ensure uniqueness
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
          const existing = await tx.service.findUnique({
            where: { slug },
          });
          if (!existing) {
            isUnique = true;
          } else {
            slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
            attempts++;
          }
        }

        const data: Prisma.ServiceCreateInput = {
          business: {
            connect: {
              id: business.id,
            },
          },
          slug,
          name: payload.name,
          description: payload.description,
          price: payload.price,
          duration: payload.duration,
          availableFrom: payload.availableFrom,
          availableTo: payload.availableTo,
          isActive: payload.isActive,
        };

        if (payload.image instanceof File) {
          const uploadResult = await cloudinaryService.uploadFile(
            payload.image,
            {
              folder: `sara/${business.id}/services`,
            },
          );
          data.image = uploadResult.secure_url;
        }

        const service = await tx.service.create({
          data,
        });

        return service;
      });

      const response: ApiResponse<Service> = {
        status: 201,
        message: "Service created successfully",
        data: serviceResult,
      };

      return NextResponse.json(response, { status: 201 });
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while creating service: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(serviceValidatorSchema)],
);

/**
 * @queryParams ServiceQueryValidatorSchema
 * @description Retrieves services for the authenticated user's business. Supports search, pagination, and filtering.
 * @auth bearer
 */
export const GET = withMiddleware<unknown, ServiceQueryValidatorSchema>(
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
          "You do not have permission to view services for this business",
        );
      }

      const where: Prisma.ServiceWhereInput = {
        businessId: business.id,
      };

      if (payload.isActive !== undefined) {
        where.isActive = payload.isActive;
      }

      if (payload.name) {
        where.name = {
          contains: payload.name,
          mode: "insensitive",
        };
      }

      if (payload.query) {
        where.OR = [
          { name: { contains: payload.query, mode: "insensitive" } },
          { description: { contains: payload.query, mode: "insensitive" } },
        ];
      }

      const orderBy: Prisma.ServiceOrderByWithRelationInput = {
        [payload.sortBy ?? "createdAt"]: payload.sortOrder ?? "desc",
      };

      if (payload.all) {
        const data = await db.service.findMany({
          where,
          orderBy,
        });

        const response: PaginatedApiResponse<ServiceListItem[]> = {
          status: 200,
          message: "Services retrieved successfully",
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
        db.service.count({ where }),
        db.service.findMany({
          where,
          take: size,
          skip,
          orderBy,
        }),
      ]);

      const response: PaginatedApiResponse<ServiceListItem[]> = {
        status: 200,
        message: "Services retrieved successfully",
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
        `An error occurred while fetching services: ${error.message}`,
      );
    }
  },
  [authMiddleware, queryValidatorMiddleware(serviceQueryValidatorSchema)],
);

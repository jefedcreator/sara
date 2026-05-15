import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import {
  businessValidatorSchema,
  updateBusinessValidatorSchema,
  type BusinessValidatorSchema,
  type UpdateBusinessValidatorSchema,
} from "@/backend/validators/business.validator";
import { db } from "@/server/db";
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import slugify from "slugify";
import type { ApiResponse } from "types";

export const runtime = "nodejs";

/**
 * @description Gets the business for the authenticated user.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request) => {
    try {
      const user = request.user!;
      const business = user.business;

      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      const response: ApiResponse = {
        status: 200,
        message: "Business retrieved successfully",
        data: business,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching business: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

/**
 * @body BusinessValidatorSchema
 * @description Creates a new business for the authenticated user.
 * @contentType application/json
 * @auth bearer
 */
export const POST = withMiddleware<BusinessValidatorSchema>(
  async (request) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;

      // Check if user already has a business
      if (user.business) {
        throw new ConflictException("You already have a business registered");
      }

      const slug =
        payload.slug || slugify(payload.name, { lower: true, strict: true });

      // Check if slug is already taken
      const existingBusinessWithSlug = await db.business.findUnique({
        where: { slug },
      });

      if (existingBusinessWithSlug) {
        throw new ConflictException("A business with this slug already exists");
      }

      const business = await db.business.create({
        data: {
          ...payload,
          slug,
          ownerId: user.id,
        },
      });

      const response: ApiResponse = {
        status: 201,
        message: "Business created successfully",
        data: business,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while creating business: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(businessValidatorSchema)],
);

/**
 * @body UpdateBusinessValidatorSchema
 * @description Updates the existing business for the authenticated user.
 * @contentType application/json
 * @auth bearer
 */
export const PUT = withMiddleware<UpdateBusinessValidatorSchema>(
  async (request) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;

      if (!user.business) {
        throw new NotFoundException("No business found to update");
      }

      let slug = user.business.slug;

      if (payload.name || payload.slug) {
        if (payload.name) {
          slug = slugify(payload.name, { lower: true, strict: true });
        } else if (payload.slug) {
          slug = payload.slug;
        }
        // Check if new slug is taken by someone else
        if (slug !== user.business.slug) {
          const existingBusinessWithSlug = await db.business.findUnique({
            where: { slug },
          });
          if (existingBusinessWithSlug) {
            throw new ConflictException(
              "A business with this slug already exists",
            );
          }
        }
      }

      const business = await db.business.update({
        where: { ownerId: user.id },
        data: {
          ...payload,
          slug,
        },
      });

      const response: ApiResponse = {
        status: 200,
        message: "Business updated successfully",
        data: business,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while updating business: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(updateBusinessValidatorSchema)],
);

/**
 * @description Deletes the business for the authenticated user.
 * @auth bearer
 */
export const DELETE = withMiddleware<unknown>(
  async (request) => {
    try {
      const user = request.user!;

      if (!user.business) {
        throw new NotFoundException("No business found to delete");
      }

      await db.business.delete({
        where: { ownerId: user.id },
      });

      const response: ApiResponse = {
        status: 200,
        message: "Business deleted successfully",
        data: null,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while deleting business: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

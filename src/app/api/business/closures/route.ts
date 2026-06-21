import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import {
  businessClosureValidatorSchema,
  type BusinessClosureValidatorSchema,
} from "@/backend/validators/business-closure.validator";
import { db } from "@/server/db";
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { type BusinessClosure } from "@prisma/client";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";

/**
 * @description Lists the authenticated user's business's one-off closures
 *              (holidays, vacation days).
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request) => {
    try {
      const user = request.user!;

      if (!user.business) {
        throw new NotFoundException("Business not found");
      }

      const closures = await db.businessClosure.findMany({
        where: { businessId: user.business.id },
        orderBy: { date: "asc" },
      });

      const response: ApiResponse<BusinessClosure[]> = {
        status: 200,
        message: "Closures retrieved successfully",
        data: closures,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching closures: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

/**
 * @body BusinessClosureValidatorSchema
 * @description Adds a one-off closure date for the authenticated user's
 *              business.
 * @contentType application/json
 * @auth bearer
 */
export const POST = withMiddleware<BusinessClosureValidatorSchema>(
  async (request) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;

      if (!user.business) {
        throw new NotFoundException("Business not found");
      }

      const closure = await db.businessClosure.create({
        data: {
          businessId: user.business.id,
          date: new Date(payload.date),
          reason: payload.reason,
        },
      });

      const response: ApiResponse<BusinessClosure> = {
        status: 201,
        message: "Closure added successfully",
        data: closure,
      };

      return NextResponse.json(response, { status: 201 });
    } catch (error: any) {
      if (error.statusCode) throw error;
      if (error.code === "P2002") {
        throw new ConflictException("A closure already exists for this date");
      }
      throw new InternalServerErrorException(
        `An error occurred while adding the closure: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(businessClosureValidatorSchema)],
);

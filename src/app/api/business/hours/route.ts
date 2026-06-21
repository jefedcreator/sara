import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import {
  businessHoursValidatorSchema,
  type BusinessHoursValidatorSchema,
} from "@/backend/validators/business-hours.validator";
import { db } from "@/server/db";
import {
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { type BusinessHours } from "@prisma/client";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";

/**
 * @description Retrieves the authenticated user's business's weekly working
 *              hours. Returns an empty array if no hours have been
 *              configured — that is the legacy "open all day" default, not
 *              an error state.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request) => {
    try {
      const user = request.user!;

      if (!user.business) {
        throw new NotFoundException("Business not found");
      }

      const days = await db.businessHours.findMany({
        where: { businessId: user.business.id },
        orderBy: { dayOfWeek: "asc" },
      });

      const response: ApiResponse<BusinessHours[]> = {
        status: 200,
        message: "Business hours retrieved successfully",
        data: days,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching business hours: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

/**
 * @body BusinessHoursValidatorSchema
 * @description Replaces the authenticated user's business's full weekly
 *              schedule in one call. Requires exactly 7 entries, one per
 *              day of the week.
 * @contentType application/json
 * @auth bearer
 */
export const PUT = withMiddleware<BusinessHoursValidatorSchema>(
  async (request) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;

      if (!user.business) {
        throw new NotFoundException("Business not found");
      }

      const businessId = user.business.id;

      const days = await db.$transaction(async (tx) => {
        await tx.businessHours.deleteMany({ where: { businessId } });
        await tx.businessHours.createMany({
          data: payload.days.map((d) => ({ ...d, businessId })),
        });
        return tx.businessHours.findMany({
          where: { businessId },
          orderBy: { dayOfWeek: "asc" },
        });
      });

      const response: ApiResponse<BusinessHours[]> = {
        status: 200,
        message: "Business hours updated successfully",
        data: days,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while updating business hours: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(businessHoursValidatorSchema)],
);

import {
  authMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import {
  dashboardService,
  type RevenueOverview,
} from "@/backend/services/dashboard";
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { ApiResponse } from "types";

// --- Query Validator ---

const overviewQuerySchema = z
  .object({
    serviceId: z.string().optional(),
    from: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}$/,
        "from must be in YYYY-MM-DD format",
      )
      .optional(),
    to: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}$/,
        "to must be in YYYY-MM-DD format",
      )
      .optional(),
  })
  .strict();

type OverviewQuerySchema = z.infer<typeof overviewQuerySchema>;

// --- Response Types ---

type OverviewResponse = RevenueOverview & {
  dateRange: {
    from: string | null;
    to: string | null;
  };
};

/**
 * @queryParams OverviewQuerySchema
 * @description Returns revenue overview per service for the authenticated user's
 *              business. Aggregates confirmed bookings, showing total revenue and
 *              booking count per service. Supports filtering by serviceId and date range.
 *
 * @queryParam serviceId - Optional. Filter to a single service.
 * @queryParam from      - Optional. Start date (YYYY-MM-DD, inclusive).
 * @queryParam to        - Optional. End date (YYYY-MM-DD, inclusive).
 *
 * @auth bearer
 */
export const GET = withMiddleware<unknown, OverviewQuerySchema>(
  async (request) => {
    try {
      const query = request.query!;
      const user = request.user!;
      const business = user.business;

      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      if (user.id !== business.ownerId) {
        throw new ForbiddenException(
          "You do not have permission to view this overview",
        );
      }

      const overview = await dashboardService.revenueByService(business.id, query);

      const response: ApiResponse<OverviewResponse> = {
        status: 200,
        message: "Overview retrieved successfully",
        data: {
          ...overview,
          dateRange: {
            from: query.from ?? null,
            to: query.to ?? null,
          },
        },
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching overview: ${error.message}`,
      );
    }
  },
  [authMiddleware, queryValidatorMiddleware(overviewQuerySchema)],
);

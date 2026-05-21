import {
  authMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { db } from "@/server/db";
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { Prisma } from "@prisma/client";
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

type ServiceOverview = {
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  totalRevenue: number;
  totalBookings: number;
};

type OverviewResponse = {
  services: ServiceOverview[];
  totalRevenue: number;
  totalBookings: number;
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

      // Build the booking filter
      const bookingWhere: Prisma.BookingWhereInput = {
        businessId: business.id,
        status: "CONFIRMED",
      };

      if (query.serviceId) {
        bookingWhere.serviceId = query.serviceId;
      }

      // Date range filter on booking createdAt
      if (query.from || query.to) {
        bookingWhere.createdAt = {};

        if (query.from) {
          (bookingWhere.createdAt as Prisma.DateTimeFilter).gte = new Date(
            `${query.from}T00:00:00.000Z`,
          );
        }

        if (query.to) {
          (bookingWhere.createdAt as Prisma.DateTimeFilter).lte = new Date(
            `${query.to}T23:59:59.999Z`,
          );
        }
      }

      // Aggregate: group confirmed bookings by service
      const bookingsWithService = await db.booking.findMany({
        where: bookingWhere,
        select: {
          serviceId: true,
          service: {
            select: {
              id: true,
              name: true,
              slug: true,
              price: true,
            },
          },
        },
      });

      // Aggregate per-service totals
      const serviceMap = new Map<
        string,
        { name: string; slug: string; revenue: number; count: number }
      >();

      for (const booking of bookingsWithService) {
        const existing = serviceMap.get(booking.serviceId);
        const price = Number(booking.service.price);

        if (existing) {
          existing.revenue += price;
          existing.count += 1;
        } else {
          serviceMap.set(booking.serviceId, {
            name: booking.service.name,
            slug: booking.service.slug,
            revenue: price,
            count: 1,
          });
        }
      }

      // Build the response
      const services: ServiceOverview[] = [];
      let totalRevenue = 0;
      let totalBookings = 0;

      for (const [serviceId, data] of serviceMap) {
        services.push({
          serviceId,
          serviceName: data.name,
          serviceSlug: data.slug,
          totalRevenue: Math.round(data.revenue * 100) / 100,
          totalBookings: data.count,
        });
        totalRevenue += data.revenue;
        totalBookings += data.count;
      }

      // Sort by revenue descending
      services.sort((a, b) => b.totalRevenue - a.totalRevenue);

      const response: ApiResponse<OverviewResponse> = {
        status: 200,
        message: "Overview retrieved successfully",
        data: {
          services,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalBookings,
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

import { authMiddleware, withMiddleware } from "@/backend/middleware";
import { dashboardService } from "@/backend/services/dashboard";
import {
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse, DashboardData } from "types";

export const runtime = "nodejs";

/**
 * @description The owner's dashboard: today's and this week's revenue, what is
 *              unpaid, today's bookings, and revenue per service. The same
 *              numbers the chat's business summary gives.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request) => {
    try {
      const business = request.user!.business;
      if (!business) throw new NotFoundException("Business not found for this user");

      const response: ApiResponse<DashboardData> = {
        status: 200,
        message: "Dashboard retrieved successfully",
        data: await dashboardService.load(business.id, business.currency),
      };
      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching the dashboard: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

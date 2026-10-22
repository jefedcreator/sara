import { withMiddleware } from "@/backend/middleware";
import { customerBackfill } from "@/backend/services/customer/backfill";
import { env } from "@/env";
import {
  InternalServerErrorException,
  UnauthorizedException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";

/**
 * @description Links existing bookings, invoices, receipts and payments to
 *              customers created from their snapshots. Guarded by a shared
 *              secret (`CRON_SECRET`) rather than user auth — there is no user
 *              in a cron request. Safe to run repeatedly.
 * @auth none — Authorization: Bearer <CRON_SECRET>
 */
export const GET = withMiddleware<unknown>(
  async (request) => {
    try {
      if (!env.CRON_SECRET) {
        throw new InternalServerErrorException(
          "CRON_SECRET is not configured",
        );
      }

      const authHeader = request.headers.get("authorization");
      if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
        throw new UnauthorizedException("Invalid or missing cron secret");
      }

      const counts = await customerBackfill.run();

      const response: ApiResponse<typeof counts> = {
        status: 200,
        message: "Customer backfill complete",
        data: counts,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while backfilling customers: ${error.message}`,
      );
    }
  },
  [],
);

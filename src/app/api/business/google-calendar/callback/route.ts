import { authMiddleware, withMiddleware } from "@/backend/middleware";
import { googleCalendarService } from "@/backend/services/googleCalendar";
import { db } from "@/server/db";
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";

/**
 * @description Exchanges the Google OAuth `code` for tokens and persists
 *              them onto the authenticated user's business. Unlike the
 *              best-effort booking-lifecycle Calendar calls, a failed
 *              connect attempt here is surfaced as an error rather than
 *              silently no-op'd — the owner needs to know if connecting
 *              didn't work.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request) => {
    try {
      const user = request.user!;

      if (!user.business) {
        throw new NotFoundException("Business not found");
      }

      const code = request.nextUrl.searchParams.get("code");
      if (!code) {
        throw new BadRequestException("Missing authorization code");
      }

      const tokens = await googleCalendarService.exchangeCodeForTokens(code);

      await db.business.update({
        where: { id: user.business.id },
        data: {
          googleCalendarId: "primary",
          googleCalendarAccessToken: tokens.accessToken,
          googleCalendarRefreshToken: tokens.refreshToken,
          googleCalendarTokenExpiry: tokens.expiresAt,
          googleCalendarConnectedAt: new Date(),
        },
      });

      const response: ApiResponse<{ connected: true }> = {
        status: 200,
        message: "Google Calendar connected successfully",
        data: { connected: true },
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while connecting Google Calendar: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

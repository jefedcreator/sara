import { authMiddleware, withMiddleware } from "@/backend/middleware";
import { googleCalendarService } from "@/backend/services/googleCalendar";
import { db } from "@/server/db";
import {
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";

/**
 * @description Disconnects Google Calendar from the authenticated user's
 *              business: best-effort token revocation at Google, then
 *              clears the stored fields regardless of whether revocation
 *              succeeded — the owner's intent is to disconnect from
 *              Sara's side either way.
 * @auth bearer
 */
export const DELETE = withMiddleware<unknown>(
  async (request) => {
    try {
      const user = request.user!;

      if (!user.business) {
        throw new NotFoundException("Business not found");
      }

      if (user.business.googleCalendarRefreshToken) {
        await googleCalendarService.revoke(
          user.business.googleCalendarRefreshToken,
        );
      }

      await db.business.update({
        where: { id: user.business.id },
        data: {
          googleCalendarId: null,
          googleCalendarAccessToken: null,
          googleCalendarRefreshToken: null,
          googleCalendarTokenExpiry: null,
          googleCalendarConnectedAt: null,
        },
      });

      const response: ApiResponse<{ connected: false }> = {
        status: 200,
        message: "Google Calendar disconnected",
        data: { connected: false },
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while disconnecting Google Calendar: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

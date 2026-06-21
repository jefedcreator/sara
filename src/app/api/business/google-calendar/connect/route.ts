import { authMiddleware, withMiddleware } from "@/backend/middleware";
import { googleCalendarService } from "@/backend/services/googleCalendar";
import { InternalServerErrorException } from "@/utils/exceptions";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";

/**
 * @description Returns (or redirects to, with ?redirect=true) the Google
 *              Calendar OAuth consent URL. Separate from the login OAuth
 *              flow — narrow, purpose-specific scopes only.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request) => {
    try {
      const state = randomBytes(16).toString("hex");
      const authorizationUrl = googleCalendarService.getAuthorizationUrl(state);
      const shouldRedirect =
        request.nextUrl.searchParams.get("redirect") === "true";

      if (shouldRedirect) {
        return NextResponse.redirect(authorizationUrl);
      }

      const response: ApiResponse<{ authorizationUrl: string }> = {
        status: 200,
        message: "Google Calendar authorization URL generated",
        data: { authorizationUrl },
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while generating the authorization URL: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

import type { NextRequest } from "next/server";

import { authService } from "@/backend/services/auth";

/**
 * @queryParams OAuthAuthorizationQueryValidatorSchema
 * @description Starts Google OAuth by returning or redirecting to the Google authorization URL.
 */
export const GET = (request: NextRequest) =>
  authService.createAuthorizationResponse(request, "google");

/**
 * @queryParams OAuthAuthorizationQueryValidatorSchema
 * @description Starts Google OAuth by returning or redirecting to the Google authorization URL.
 */
export const POST = GET;

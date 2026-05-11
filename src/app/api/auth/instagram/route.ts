import type { NextRequest } from "next/server";

import { authService } from "@/backend/services/auth";

/**
 * @queryParams OAuthAuthorizationQueryValidatorSchema
 * @description Starts Instagram OAuth by returning or redirecting to the Instagram authorization URL.
 */
export const GET = (request: NextRequest) =>
  authService.createAuthorizationResponse(request, "instagram");

/**
 * @queryParams OAuthAuthorizationQueryValidatorSchema
 * @description Starts Instagram OAuth by returning or redirecting to the Instagram authorization URL.
 */
export const POST = GET;

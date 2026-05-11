import type { NextRequest } from "next/server";

import { authService } from "@/backend/services/auth";

/**
 * @queryParams OAuthAuthorizationQueryValidatorSchema
 * @description Starts Facebook OAuth by returning or redirecting to the Facebook authorization URL.
 */
export const GET = (request: NextRequest) =>
  authService.createAuthorizationResponse(request, "facebook");

/**
 * @queryParams OAuthAuthorizationQueryValidatorSchema
 * @description Starts Facebook OAuth by returning or redirecting to the Facebook authorization URL.
 */
export const POST = GET;

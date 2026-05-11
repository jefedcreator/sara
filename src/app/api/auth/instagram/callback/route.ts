import type { NextRequest } from "next/server";

import { authService } from "@/backend/services/auth";

/**
 * @queryParams OAuthCallbackQueryValidatorSchema
 * @description Handles the Instagram OAuth callback, creates a user session, and returns or redirects with the session token.
 */
export const GET = (request: NextRequest) =>
  authService.createCallbackResponse(request, "instagram");

/**
 * @body OAuthCallbackValidatorSchema
 * @queryParams OAuthCallbackQueryValidatorSchema
 * @description Handles the Instagram OAuth callback from a JSON payload, creates a user session, and returns or redirects with the session token.
 * @contentType application/json
 */
export const POST = GET;

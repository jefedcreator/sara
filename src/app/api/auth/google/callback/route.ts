import type { NextRequest } from "next/server";

import { authService } from "@/backend/services/auth";

/**
 * @queryParams OAuthCallbackQueryValidatorSchema
 * @description Completes Google sign-in: checks the signed state, redeems the code, links or creates the owner's account and sets the session cookie. Redirects to the requested page, or to /sign-in with an error code.
 */
export const GET = (request: NextRequest) =>
  authService.completeSignIn(request, "google");

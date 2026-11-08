import { withMiddleware } from "@/backend/middleware";
import { authService } from "@/backend/services/auth";
import { oauthErrorResponse } from "@/backend/services/auth/redirect";

/**
 * @queryParams OAuthCallbackQueryValidatorSchema
 * @description Completes Instagram sign-in: checks the signed state, redeems the code, links or creates the owner's account and sets the session cookie. Redirects to the requested page, or to /signin with an error code.
 */
export const GET = withMiddleware<unknown>(
  async (request) => authService.completeSignIn(request, "instagram"),
  [],
  oauthErrorResponse,
);

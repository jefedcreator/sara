import { withMiddleware } from "@/backend/middleware";
import { authService } from "@/backend/services/auth";
import { oauthErrorResponse } from "@/backend/services/auth/redirect";

/**
 * @queryParams OAuthAuthorizationQueryValidatorSchema
 * @description Starts Instagram sign-in by redirecting to Instagram's consent screen. Returns to `next` (a same-site path) once signed in.
 */
export const GET = withMiddleware<unknown>(
  async (request) => authService.startSignIn(request, "instagram"),
  [],
  oauthErrorResponse,
);

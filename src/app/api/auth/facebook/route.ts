import type { NextRequest } from "next/server";

import { authService } from "@/backend/services/auth";

/**
 * @queryParams OAuthAuthorizationQueryValidatorSchema
 * @description Starts Facebook sign-in by redirecting to Facebook's consent screen. Returns to `next` (a same-site path) once signed in.
 */
export const GET = (request: NextRequest) =>
  authService.startSignIn(request, "facebook");

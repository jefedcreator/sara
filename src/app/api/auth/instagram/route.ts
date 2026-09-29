import type { NextRequest } from "next/server";

import { authService } from "@/backend/services/auth";

/**
 * @queryParams OAuthAuthorizationQueryValidatorSchema
 * @description Starts Instagram sign-in by redirecting to Instagram's consent screen. Returns to `next` (a same-site path) once signed in.
 */
export const GET = (request: NextRequest) =>
  authService.startSignIn(request, "instagram");

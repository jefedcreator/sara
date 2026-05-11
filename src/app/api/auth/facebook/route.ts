import type { NextRequest } from "next/server";

import { authService } from "@/backend/services/auth";

export const GET = (request: NextRequest) =>
  authService.createAuthorizationResponse(request, "facebook");

export const POST = GET;

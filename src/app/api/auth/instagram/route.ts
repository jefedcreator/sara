import type { NextRequest } from "next/server";

import { authService } from "@/backend/services/auth";

export const GET = (request: NextRequest) =>
  authService.createAuthorizationResponse(request, "instagram");

export const POST = GET;

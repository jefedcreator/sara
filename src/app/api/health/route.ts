import { withMiddleware } from "@/backend/middleware";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";

interface HealthData {
  ok: boolean;
}

/**
 * @description Liveness probe for deploy/deploy.sh, which polls it on
 *              127.0.0.1 after a release goes live and rolls back if it never
 *              answers. Deliberately unauthenticated and database-free: it
 *              reports that this release booted, not that its dependencies
 *              are up. It exposes no account data.
 * @auth none
 */
export const GET = withMiddleware(async () => {
  const response: ApiResponse<HealthData> = {
    status: 200,
    message: "Healthy",
    data: { ok: true },
  };
  return NextResponse.json(response);
}, []);

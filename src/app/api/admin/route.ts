import { manifestHandler } from "@/backend/admin/handlers";
import { adminPreflight, adminRoute } from "@/backend/admin/kit/access";
import { adminAuthMiddleware } from "@/backend/admin/middleware";
import { withMiddleware } from "@/backend/middleware";

/**
 * @description Admin manifest: every resource, its fields and its record count. Answers 404 unless the admin API is switched on with ADMIN_API_TOKEN.
 * @auth bearer
 */
export const GET = adminRoute(
  withMiddleware(manifestHandler, [adminAuthMiddleware]),
);

/**
 * @description CORS preflight for the admin API. Needs no token.
 */
export const OPTIONS = adminPreflight;

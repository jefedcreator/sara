import { analyticsHandler } from "@/backend/admin/handlers";
import { adminPreflight, adminRoute } from "@/backend/admin/kit/access";
import type { AnalyticsDays } from "@/backend/admin/kit/analytics";
import {
  adminAnalyticsQueryMiddleware,
  adminAuthMiddleware,
} from "@/backend/admin/middleware";
import { withMiddleware } from "@/backend/middleware";

/**
 * @queryParams adminAnalyticsQueryDoc
 * @description Admin analytics: Google Analytics visitors, page views and enquiries for the requested window. Answers 404 unless the admin API is switched on with ADMIN_API_TOKEN.
 * @auth bearer
 */
export const GET = adminRoute(
  withMiddleware<unknown, { days: AnalyticsDays }>(analyticsHandler, [
    adminAuthMiddleware,
    adminAnalyticsQueryMiddleware,
  ]),
);

/**
 * @description CORS preflight for the admin API. Needs no token.
 */
export const OPTIONS = adminPreflight;

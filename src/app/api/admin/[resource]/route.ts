import { createHandler, listHandler } from "@/backend/admin/handlers";
import { adminPreflight, adminRoute } from "@/backend/admin/kit/access";
import type { AdminListQuery, AdminWriteBody } from "@/backend/admin/kit/types";
import {
  adminAuthMiddleware,
  adminBodyMiddleware,
  adminCanMiddleware,
  adminListQueryMiddleware,
  adminResourceMiddleware,
} from "@/backend/admin/middleware";
import { withMiddleware } from "@/backend/middleware";

/**
 * @pathParams adminResourceParams
 * @queryParams adminListQueryDoc
 * @description Lists one page of a resource's records. Besides the common parameters, each filterable field of the resource is a parameter; unknown parameters answer 422.
 * @auth bearer
 */
export const GET = adminRoute(
  withMiddleware<unknown, AdminListQuery>(listHandler, [
    adminAuthMiddleware,
    adminResourceMiddleware,
    adminListQueryMiddleware,
  ]),
);

/**
 * @pathParams adminResourceParams
 * @body adminWriteBodyDoc
 * @description Creates a record. Answers 403 for a resource that doesn't allow it, and 422 naming any field that is read-only, hidden or unknown.
 * @auth bearer
 */
export const POST = adminRoute(
  withMiddleware<AdminWriteBody>(createHandler, [
    adminAuthMiddleware,
    adminResourceMiddleware,
    adminCanMiddleware("create"),
    adminBodyMiddleware("create"),
  ]),
);

/**
 * @description CORS preflight for the admin API. Needs no token.
 */
export const OPTIONS = adminPreflight;

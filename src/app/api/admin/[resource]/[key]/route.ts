import {
  readHandler,
  removeHandler,
  updateHandler,
} from "@/backend/admin/handlers";
import { adminPreflight, adminRoute } from "@/backend/admin/kit/access";
import type { AdminWriteBody } from "@/backend/admin/kit/types";
import {
  adminAuthMiddleware,
  adminBodyMiddleware,
  adminCanMiddleware,
  adminResourceMiddleware,
} from "@/backend/admin/middleware";
import { withMiddleware } from "@/backend/middleware";

/**
 * @pathParams adminRecordParams
 * @description Reads one record by its _key. Answers 404 for a key that doesn't decode or a record that doesn't exist.
 * @auth bearer
 */
export const GET = adminRoute(
  withMiddleware(readHandler, [adminAuthMiddleware, adminResourceMiddleware]),
);

/**
 * @pathParams adminRecordParams
 * @body adminWriteBodyDoc
 * @description Changes some fields of a record; the body is partial. Answers 403 for a resource that doesn't allow it, and 422 naming any field that is read-only, hidden or unknown.
 * @auth bearer
 */
export const PUT = adminRoute(
  withMiddleware<AdminWriteBody>(updateHandler, [
    adminAuthMiddleware,
    adminResourceMiddleware,
    adminCanMiddleware("update"),
    adminBodyMiddleware("update"),
  ]),
);

/**
 * @pathParams adminRecordParams
 * @description Deletes a record. Answers 409 while other records still point at it, and 403 for a resource that doesn't allow it.
 * @auth bearer
 */
export const DELETE = adminRoute(
  withMiddleware(removeHandler, [
    adminAuthMiddleware,
    adminResourceMiddleware,
    adminCanMiddleware("delete"),
  ]),
);

/**
 * @description CORS preflight for the admin API. Needs no token.
 */
export const OPTIONS = adminPreflight;

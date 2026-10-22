import type {
  AuthRequest,
  MiddlewareResponse,
  QueryParameters,
} from "@/backend/middleware/types";
import { adminEnabled, tokenMatches } from "./kit/access";
import { forbidden, notFound } from "./kit/errors";
import { whereForKey } from "./kit/keys";
import { listQuerySchema, writeSchema } from "./kit/schema";
import type { AdminResource } from "./kit/types";
import { resolvedAdmin } from "./registry";

// Run in this order: auth → resource → can → list query or body. Each one
// answers like Sara's own middleware: `next: false` with a status and a
// `{ message }` body, written by `withMiddleware`.

const proceed = (): MiddlewareResponse => ({
  message: "",
  statusCode: 200,
  next: true,
});

const stop = (statusCode: number, message: string): MiddlewareResponse => ({
  message,
  statusCode,
  next: false,
});

/** The resource named by the path, or undefined for one that isn't registered. */
function resourceOf(
  params: Record<string, string> | undefined,
): AdminResource | undefined {
  return resolvedAdmin.byKey.get(params?.resource ?? "");
}

/** 404 `Not Found` when the admin is off, 401 `Unauthorized` on a bad token. */
export const adminAuthMiddleware = async <B = unknown, Q = QueryParameters>(
  request: AuthRequest<B, Q>,
): Promise<MiddlewareResponse> => {
  if (!adminEnabled()) return stop(404, "Not Found");
  if (!tokenMatches(request.headers.get("authorization"))) {
    return stop(401, "Unauthorized");
  }
  return proceed();
};

/** 404 for an unknown resource, or for a `:key` that can't name a record. */
export const adminResourceMiddleware = async <B = unknown, Q = QueryParameters>(
  request: AuthRequest<B, Q>,
): Promise<MiddlewareResponse> => {
  const resource = resourceOf(request.params);
  if (!resource) return stop(404, "Not Found");
  const key = request.params?.key;
  if (key !== undefined && whereForKey(resource, key) === null) {
    return stop(404, notFound(resource).message);
  }
  return proceed();
};

/** 403 `<Label> can't be created here` (or changed, deleted). */
export const adminCanMiddleware =
  (action: "create" | "update" | "delete") =>
  async <B = unknown, Q = QueryParameters>(
    request: AuthRequest<B, Q>,
  ): Promise<MiddlewareResponse> => {
    const resource = resourceOf(request.params);
    if (!resource) return stop(404, "Not Found");
    if (!resource.can[action]) {
      return stop(403, forbidden(resource, action).message);
    }
    return proceed();
  };

/**
 * Parses the list parameters and sets `request.query`. The 422 is the one
 * `queryValidatorMiddleware` gives.
 */
export const adminListQueryMiddleware = async <
  B = unknown,
  Q = QueryParameters,
>(
  request: AuthRequest<B, Q>,
): Promise<MiddlewareResponse> => {
  const resource = resourceOf(request.params);
  if (!resource) return stop(404, "Not Found");
  try {
    const searchParams = request.nextUrl.searchParams;
    const query: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const result = listQuerySchema(resource).safeParse(query);
    if (!result.success) {
      const errorPath = result.error.issues[0]?.message;
      return stop(
        422,
        errorPath
          ? `Invalid query parameter: ${errorPath}`
          : "Invalid query parameters",
      );
    }
    request.query = result.data;
  } catch (error) {
    console.error(error);
    return stop(400, "Error parsing query parameters");
  }
  return proceed();
};

/**
 * Validates the JSON body against the resource's writable fields and sets
 * `request.validatedData`. The 422 is `path: message`, as
 * `bodyValidatorMiddleware` gives.
 */
export const adminBodyMiddleware =
  (mode: "create" | "update") =>
  async <B = unknown, Q = QueryParameters>(
    request: AuthRequest<B, Q>,
  ): Promise<MiddlewareResponse> => {
    const resource = resourceOf(request.params);
    if (!resource) return stop(404, "Not Found");

    // `withMiddleware` leaves `parsedBody` unset for a missing or malformed
    // JSON body; a body that isn't an object has no field to name either.
    const body: unknown = request.parsedBody;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return stop(422, "Request body must be a JSON object");
    }

    const result = writeSchema(resource, mode).safeParse(body);
    if (!result.success) {
      const firstError = result.error.issues[0];
      const errorPath = firstError?.path.join(".");
      const errorMessage = firstError?.message;
      return stop(
        422,
        errorPath
          ? `${errorPath}: ${errorMessage}`
          : (errorMessage ?? "Validation failed"),
      );
    }
    request.validatedData = result.data;
    return proceed();
  };

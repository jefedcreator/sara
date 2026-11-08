import { authService } from "@/backend/services/auth";
import { env } from "@/env";
import { logRequest, parseHttpError } from "@/utils";
import { HttpException, UnauthorizedException } from "@/utils/exceptions";
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { type z } from "zod";
import type {
  AuthRequest,
  MiddlewareFunction,
  MiddlewareResponse,
  QueryParameters,
} from "./types";

/**
 *
 * @param handler (request: AuthRequest) => Promise<Response>
 *
 * @param middlewares MiddlewareFunction[]
 *
 * @returns
 */

const getExternalUrl = (url: string) => {
  const baseUrl = env.NEXT_PUBLIC_APP_URL ?? env.NEXTAUTH_URL;
  if (!baseUrl) return url;

  try {
    const parsedUrl = new URL(url);
    const parsedBase = new URL(baseUrl);
    return `${parsedBase.origin}${parsedUrl.pathname}${parsedUrl.search}`;
  } catch {
    return url;
  }
};

export const withMiddleware = <B = unknown, Q = QueryParameters>(
  handler: (
    request: AuthRequest<B, Q>,
    context: { params: Record<string, string> },
  ) => Promise<Response>,
  middlewares: MiddlewareFunction<B, Q>[],
  /**
   * Turns a thrown error into the status and user-safe message this route
   * answers with. Defaults to the exception's `statusCode` and `message`.
   * A route with its own error vocabulary (the assistant's codes) passes one
   * rather than bypassing the wrapper. `body` adds fields to the error
   * envelope for clients that read the status from the body as well, and
   * `response` replaces the JSON envelope entirely for routes that answer
   * with a redirect (the OAuth routes).
   */
  errorFormatter: (
    error: unknown,
    request: AuthRequest<B, Q>,
  ) => {
    status: number;
    message: string;
    body?: Record<string, unknown>;
    response?: Response;
  } = (error) => ({
    status:
      error instanceof HttpException
        ? error.statusCode
        : ((error as { statusCode?: number }).statusCode ?? 500),
    message: parseHttpError(error) ?? "Internal server error",
  }),
) => {
  const executeRequest = async (
    req: NextResponse | Request | any,
    context: { params: Promise<Record<string, string>> } | any,
  ) => {
    const request = req as AuthRequest<B, Q> & { parsedBodyValue?: B };

    // Parse the body lazily, on first read of `parsedBody`, so an auth
    // middleware that rejects the request never touches it. Routes that read
    // the body by hand (`readAssistantInput`, the webhooks) still get a
    // pristine stream.
    let bodyParsed = false;
    const parseBody = async () => {
      if (bodyParsed) return;
      bodyParsed = true;
      try {
        const contentType =
          request.headers.get("content-type") ?? "application/json";

        if (contentType.includes("application/json")) {
          const body = (await request.json().catch(() => null)) as B;
          if (body) {
            request.parsedBodyValue = body;
            request.files = {};
            request.rawFormData = undefined;
          }
        } else if (contentType.includes("multipart/form-data")) {
          const formData = await request.formData();
          request.rawFormData = formData;
          const parsedBody: Record<string, unknown> = {};
          const files: Record<string, File> = {};

          for (const [key, value] of formData.entries()) {
            if (value instanceof File) {
              if (value.size > 0 && value.name) {
                files[key] = value;
              }
            } else {
              parsedBody[key] = value;
            }
          }

          request.parsedBodyValue = { ...parsedBody, ...files } as B;
          request.files = files;
        }
      } catch (_error) {
        // A body that will not parse is left absent; the validator refuses it.
      }
    };
    // A getter cannot be awaited, so `parsedBody` is a promise-backed
    // property: the first read starts the parse and every read after it
    // returns the same promise. `bodyValidatorMiddleware` awaits it.
    let bodyPromise: Promise<B | undefined> | undefined;
    Object.defineProperty(request, "parsedBody", {
      configurable: true,
      get() {
        bodyPromise ??= parseBody().then(() => request.parsedBodyValue);
        return bodyPromise;
      },
      set(value: B | undefined) {
        request.parsedBodyValue = value;
        bodyPromise = Promise.resolve(value);
      },
    });

    try {
      // Resolve and attach path parameters
      const resolvedParams = await (context?.params ?? Promise.resolve({}));
      request.params = resolvedParams;

      // Parse Query Parameters
      const searchParams =
        request.nextUrl?.searchParams || new URL(request.url).searchParams;
      const query: Record<string, string> = {};
      searchParams.forEach((value: string, key: string) => {
        query[key] = value;
      });
      request.query = query as Q;
    } catch (_error) {
      // A request with no URL to parse still reaches the handler, which
      // answers with its own error.
    }

    try {
      for (const middleware of middlewares) {
        const result = await middleware(request);
        if (!result.next) {
          return NextResponse.json(
            { message: result.message },
            { status: result.statusCode || 400 },
          );
        }
      }
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { type: "middleware_error" },
        extra: {
          url: getExternalUrl(request.url),
          method: request.method,
          params: request.params,
          query: request.query,
        },
        user: request.user
          ? { id: request.user.id, email: request.user.email ?? undefined }
          : undefined,
      });

      const formatted = errorFormatter(error, request);
      if (formatted.response) return formatted.response;
      const { status, message, body } = formatted;
      return NextResponse.json({ ...body, message }, { status });
    }

    try {
      return await handler(request, { params: request.params! });
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { type: "handler_error" },
        extra: {
          url: getExternalUrl(request.url),
          method: request.method,
          params: request.params,
          query: request.query,
          body: request.parsedBodyValue,
        },
        user: request.user
          ? { id: request.user.id, email: request.user.email ?? undefined }
          : undefined,
      });

      const formatted = errorFormatter(error, request);
      if (formatted.response) return formatted.response;
      const { status, message, body } = formatted;
      return NextResponse.json({ ...body, message }, { status });
    }
  };

  return async (
    req: NextResponse | Request | any,
    context: { params: Promise<Record<string, string>> } | any,
  ) => {
    const startTime = Date.now();
    const method = req.method;
    // const url = req.nextUrl?.pathname || new URL(req.url).pathname;
    const url = req.nextUrl
      ? `${req.nextUrl.pathname}${req.nextUrl.search}`
      : (() => {
          const parsed = new URL(req.url);
          return `${parsed.pathname}${parsed.search}`;
        })();
    const response = await executeRequest(req, context);
    const duration = Date.now() - startTime;
    logRequest(
      method,
      url,
      response.status,
      duration,
      (req as AuthRequest<B, Q> & { parsedBodyValue?: B }).parsedBodyValue,
    );
    return response;
  };
};

/**
 * Validates path parameters using a Zod schema.
 * @param schema Zod schema to validate params against (e.g. z.object({ id: mongoIdValidator }))
 */
export const pathParamValidatorMiddleware =
  (schema: z.ZodObject<any>) =>
  async (request: AuthRequest<any, any>): Promise<MiddlewareResponse> => {
    const params = request.params ?? {};
    const result = schema.safeParse(params);

    if (result.success) {
      return {
        message: "",
        statusCode: 200,
        next: true,
      };
    } else {
      const firstError = result.error.issues[0];
      const errorPath = firstError?.path.join(".");
      const errorMessage = firstError?.message;

      return {
        message: errorPath
          ? `${errorPath}: ${errorMessage}`
          : (errorMessage ?? ""),
        statusCode: 422,
        next: false,
      };
    }
  };

export const authMiddleware = async <B = unknown, Q = QueryParameters>(
  request: AuthRequest<B, Q>,
): Promise<MiddlewareResponse> => {
  // The Auth.js session JWT (cookie, or Bearer for non-browser clients),
  // then the live `Session` row it names.
  const session = await authService
    .sessionFromRequest(request)
    .catch((error) => {
      console.error("Auth error:", error);
      return null;
    });
  if (!session) throw new UnauthorizedException("Unauthorized");

  request.user = { ...session.user, session };

  return {
    message: "",
    statusCode: 200,
    next: true,
  };
};

export const optionalAuthMiddleware = async <B = unknown, Q = QueryParameters>(
  request: AuthRequest<B, Q>,
): Promise<MiddlewareResponse> => {
  const session = await authService
    .sessionFromRequest(request)
    .catch((error) => {
      console.error("Optional Auth error:", error);
      return null;
    });
  request.user = session ? { ...session.user, session } : null;

  return {
    message: "",
    statusCode: 200,
    next: true,
  };
};

/**
 *
 * @param request AuthRequest
 *
 * @returns
 */
export const queryValidatorMiddleware =
  <Q extends z.ZodTypeAny>(schema: Q) =>
  async (
    request: AuthRequest<unknown, z.infer<Q>>,
  ): Promise<MiddlewareResponse> => {
    try {
      const searchParams =
        request.nextUrl?.searchParams ?? new URL(request.url).searchParams;
      const query: Record<string, string> = {};
      searchParams.forEach((value, key) => {
        query[key] = value;
      });

      const result = schema.safeParse(query);

      if (!result.success) {
        const errorPath = result.error.issues[0]?.message;

        return {
          message: errorPath
            ? `Invalid query parameter: ${errorPath}`
            : "Invalid query parameters",
          statusCode: 422,
          next: false,
        };
      }

      request.query = result.data;
    } catch (error) {
      console.error(error);
      return {
        message: "Error parsing query parameters",
        statusCode: 400,
        next: false,
      };
    }

    return {
      message: "",
      statusCode: 200,
      next: true,
    };
  };

/**
 *
 * @param request AuthRequest
 *
 * @returns
 */

export const bodyValidatorMiddleware =
  <B extends z.ZodTypeAny>(schema: B) =>
  async (
    request: AuthRequest<z.infer<B>, unknown>,
  ): Promise<MiddlewareResponse> => {
    // Validate the parsed body alone. Merging `request.files` in would hand a
    // multipart schema a key per uploaded file, which a strict schema rejects
    // for every upload that isn't declared on it. A schema that wants a file
    // declares it (`z.instanceof(File).optional()`); `withMiddleware` has
    // already put the files on the body for `multipart/form-data`.
    const body = (await request.parsedBody) ?? {};
    const dataToValidate = body as Record<string, unknown>;
    const result = schema.safeParse(dataToValidate);

    if (result.success) {
      request.validatedData = result.data;

      return {
        message: "",
        statusCode: 200,
        next: true,
      };
    } else {
      const firstError = result.error.issues[0];
      const errorPath = firstError?.path.join(".");
      const errorMessage = firstError?.message;

      return {
        message: errorPath
          ? `${errorPath}: ${errorMessage}`
          : (errorMessage ?? "Validation failed"),
        statusCode: 422,
        next: false,
      };
    }
  };

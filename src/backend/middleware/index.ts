import { db } from '@/server/db';
import { parseHttpError } from '@/utils';
import { HttpException, UnauthorizedException } from '@/utils/exceptions';
import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { type z } from 'zod';
import type {
  AuthRequest,
  I_JwtPayload,
  MiddlewareFunction,
  MiddlewareResponse,
  QueryParameters,
} from './types';

/**
 *
 * @param handler (request: AuthRequest) => Promise<Response>
 *
 * @param middlewares MiddlewareFunction[]
 *
 * @returns
 */

const getExternalUrl = (url: string) => {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL;
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
    context: { params: Record<string, string> }
  ) => Promise<Response>,
  middlewares: MiddlewareFunction<B, Q>[]
) => {
  const executeRequest = async (
    req: NextResponse | Request | any,
    context: { params: Promise<Record<string, string>> } | any
  ) => {
    const request = req as AuthRequest<B, Q>;
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

      const contentType =
        request.headers.get('content-type') ?? 'application/json';

      if (contentType.includes('application/json')) {
        const body = (await request.json().catch(() => null)) as B;
        if (body) {
          request.parsedBody = body;
          request.files = {};
        }
      } else if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
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
        console.log('parsedBody', parsedBody);

        request.parsedBody = parsedBody as B;
        request.files = files;
      }
    } catch (_error) {
      // Silently handle parsing errors
    }

    try {
      for (const middleware of middlewares) {
        const result = await middleware(request);
        if (!result.next) {
          return NextResponse.json(
            { message: result.message },
            { status: result.statusCode || 400 }
          );
        }
      }
    } catch (error: any) {
      console.error('Middleware execution error:', error);

      Sentry.captureException(error, {
        tags: {
          type: 'middleware_error',
        },
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

      const statusCode =
        error instanceof HttpException
          ? error.statusCode
          : (error.statusCode ?? 500);
      return NextResponse.json(
        { message: parseHttpError(error) ?? 'Internal server error' },
        { status: statusCode }
      );
    }

    try {
      return await handler(request, { params: request.params! });
    } catch (error: any) {
      console.error('Handler error:', error);

      Sentry.captureException(error, {
        tags: {
          type: 'handler_error',
        },
        extra: {
          url: getExternalUrl(request.url),
          method: request.method,
          params: request.params,
          query: request.query,
          body: request.parsedBody,
        },
        user: request.user
          ? { id: request.user.id, email: request.user.email ?? undefined }
          : undefined,
      });

      const statusCode =
        error instanceof HttpException
          ? error.statusCode
          : (error.statusCode ?? 500);
      return NextResponse.json(
        { message: parseHttpError(error) ?? 'Internal server error' },
        { status: statusCode }
      );
    }
  };

  return async (
    req: NextResponse | Request | any,
    context: { params: Promise<Record<string, string>> } | any
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
    const statusCode = response.status;

    let statusColor = '\x1b[32m';
    if (statusCode >= 300) statusColor = '\x1b[36m';
    if (statusCode >= 400) statusColor = '\x1b[33m';
    if (statusCode >= 500) statusColor = '\x1b[31m';
    const resetColor = '\x1b[0m';

    const authReq = req as AuthRequest<B, Q>;
    const sanitizedBody = authReq.parsedBody
      ? JSON.parse(JSON.stringify(authReq.parsedBody))
      : {};

    const sensitiveKeys = ['password', 'token', 'creditCard'];
    sensitiveKeys.forEach((key) => {
      if (sanitizedBody[key]) sanitizedBody[key] = '*****';
    });

    const message = `${method} ${url} ${statusColor}${statusCode}${resetColor} - ${duration}ms`;

    if (statusCode >= 500) {
      console.error(message);
    } else {
      console.log(message);
    }

    if (Object.keys(sanitizedBody).length > 0) {
      console.debug(`Payload: ${JSON.stringify(sanitizedBody)}`);
    }

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
        message: 'Invalid ID parameter',
        statusCode: 200,
        next: true,
      };
    } else {
      const firstError = result.error.issues[0];
      const errorPath = firstError?.path.join('.');
      const errorMessage = firstError?.message;

      return {
        message: errorPath
          ? `${errorPath}: ${errorMessage}`
          : (errorMessage ?? ''),
        statusCode: 422,
        next: false,
      };
    }
  };

/**
 *
 * @param request AuthRequest
 *
 * @returns
 */
export const authMiddleware = async <B = unknown, Q = QueryParameters>(
  request: AuthRequest<B, Q>
): Promise<MiddlewareResponse> => {
  const token = request.headers.get('authorization')!;

  try {
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }

    const auth_token = token.replace(/^Bearer\s+/i, '').trim();
    if (!auth_token || auth_token === 'undefined' || auth_token === 'null') {
      throw new UnauthorizedException('Invalid auth token format');
    }

    const decoded = jwt.verify(
      auth_token,
      process.env.AUTH_SECRET!
    ) as I_JwtPayload;

    if (!decoded || !decoded.uid) {
      throw new UnauthorizedException('Unauthorized');
    }

    const user = await db.user.findUnique({
      where: {
        id: decoded.uid,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    request.user = user;
  } catch (error: any) {
    console.error('Auth error:', error.message || error);
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedException('Session expired');
    }
    if (error instanceof UnauthorizedException) {
      throw error;
    }
    throw new UnauthorizedException('Invalid auth token');
  }

  return {
    message: '',
    statusCode: 200,
    next: true,
  };
};

export const optionalAuthMiddleware = async <B = unknown, Q = QueryParameters>(
  request: AuthRequest<B, Q>
): Promise<MiddlewareResponse> => {
  const authHeader = request.headers.get('authorization');

  if (!authHeader) {
    request.user = null;
    return {
      message: '',
      statusCode: 200,
      next: true,
    };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || token === 'undefined' || token === 'null') {
    request.user = null;
    return {
      message: '',
      statusCode: 200,
      next: true,
    };
  }

  try {
    const decoded = jwt.verify(token, process.env.AUTH_SECRET!) as I_JwtPayload;

    if (!decoded || !decoded.uid) {
      request.user = null;
    } else {
      const user = await db.user.findUnique({
        where: { id: decoded.uid },
      });
      request.user = user;
    }
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      request.isExpired = true;
    }
    request.user = null;
  }

  return {
    message: '',
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
    request: AuthRequest<unknown, z.infer<Q>>
  ): Promise<MiddlewareResponse> => {
    try {
      const searchParams = request.nextUrl.searchParams;
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
            : 'Invalid query parameters',
          statusCode: 422,
          next: false,
        };
      }

      request.query = result.data;
    } catch (error) {
      console.error(error);
      return {
        message: 'Error parsing query parameters',
        statusCode: 400,
        next: false,
      };
    }

    return {
      message: '',
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
    request: AuthRequest<z.infer<B>, unknown>
  ): Promise<MiddlewareResponse> => {
    const body = request.parsedBody ?? {};
    // const query = request.query ?? {};
    const files = (request.files as Record<string, unknown>) ?? {};

    const dataToValidate = {
      ...(body as Record<string, unknown>),
      // ...(query as Record<string, unknown>),
      ...files,
    };
    const result = schema.safeParse(dataToValidate);

    if (result.success) {
      request.validatedData = result.data;

      return {
        message: '',
        statusCode: 200,
        next: true,
      };
    } else {
      const firstError = result.error.issues[0];
      const errorPath = firstError?.path.join('.');
      const errorMessage = firstError?.message;

      return {
        message: errorPath
          ? `${errorPath}: ${errorMessage}`
          : (errorMessage ?? 'Validation failed'),
        statusCode: 422,
        next: false,
      };
    }
  };

# Next.js Backend Patterns — Handover Document

This document describes the server-side architecture used in this project. A new agent implementing a fresh Next.js app should replicate every pattern here exactly.

---

## Table of Contents

1. [Project Layout](#1-project-layout)
2. [Core Dependencies](#2-core-dependencies)
3. [Custom Exception Classes](#3-custom-exception-classes)
4. [Request/Response Types](#4-requestresponse-types)
5. [Middleware System](#5-middleware-system)
6. [Validators (Zod)](#6-validators-zod)
7. [API Route Handlers](#7-api-route-handlers)
8. [Services Layer](#8-services-layer)
9. [Database (Prisma)](#9-database-prisma)
   - [Typed Prisma objects](#typed-prisma-objects-type-safety-rule)
10. [Auth (Cookie Sessions + OAuth)](#10-auth-cookie-sessions--oauth)
11. [Logging](#11-logging)
12. [Utility Helpers](#12-utility-helpers)
13. [Global Next.js Middleware](#13-global-nextjs-middleware)
14. [End-to-End Request Flow](#14-end-to-end-request-flow)
15. [Scheduling & Availability](#15-scheduling--availability)
16. [Google Calendar Integration](#16-google-calendar-integration)
17. [Conventions & Rules](#17-conventions--rules)

---

## 1. Project Layout

```
src/
├── app/
│   └── api/                        # Next.js route handlers
│       └── [resource]/
│           ├── route.ts            # GET, POST handlers
│           └── [id]/
│               └── route.ts        # GET, PUT, DELETE handlers
├── backend/
│   ├── middleware/
│   │   ├── index.ts                # withMiddleware + all middleware fns
│   │   └── types.ts                # AuthRequest, MiddlewareFunction, etc.
│   ├── validators/
│   │   ├── index.validator.ts      # Shared: pagination, base params
│   │   └── [resource].validator.ts # Per-domain Zod schemas
│   ├── services/
│   │   └── [domain]/
│   │       └── index.ts            # Class-based singleton service
│   └── cron/                       # Scheduled job implementations
├── server/
│   ├── db.ts                       # Prisma singleton
│   └── auth/
│       └── config.ts               # OAuth provider configs (clientId, scopes, URLs)
│       └── index.ts                # Exported auth handlers
├── utils/
│   ├── exceptions.ts               # HttpException subclasses
│   └── index.ts                    # logRequest, parseHttpError, helpers
└── middleware.ts                    # Next.js global middleware (route guards)
```

---

## 2. Core Dependencies

```json
{
  "dependencies": {
    "next": "^15",
    "@prisma/client": "latest",
    "zod": "^3",
    "bcryptjs": "^3",
    "@sentry/nextjs": "latest"
  },
  "devDependencies": {
    "prisma": "latest",
    "@types/bcryptjs": "^2"
  }
}
```

`jsonwebtoken` and `next-auth` are **not used** — sessions are random tokens stored in the database and transported via httpOnly cookie. No JWT signing, no NextAuth runtime.

Required env vars:
```
DATABASE_URL=         # Prisma connection string
NEXT_PUBLIC_APP_URL=  # Public base URL (used for OAuth redirect URIs)

# Per OAuth provider
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

---

## 3. Custom Exception Classes

**File:** `src/utils/exceptions.ts`

All HTTP errors are thrown as typed exceptions. The middleware catches them and maps `statusCode` to the HTTP response status automatically.

```typescript
export class HttpException extends Error {
  constructor(
    public override message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, HttpException.prototype);
  }
}

export class BadRequestException extends HttpException {
  constructor(message = 'Bad Request') {
    super(message, 400);
    Object.setPrototypeOf(this, BadRequestException.prototype);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message = 'Unauthorized') {
    super(message, 401);
    Object.setPrototypeOf(this, UnauthorizedException.prototype);
  }
}

export class ForbiddenException extends HttpException {
  constructor(message = 'Forbidden') {
    super(message, 403);
    Object.setPrototypeOf(this, ForbiddenException.prototype);
  }
}

export class NotFoundException extends HttpException {
  constructor(message = 'Not Found') {
    super(message, 404);
    Object.setPrototypeOf(this, NotFoundException.prototype);
  }
}

export class ConflictException extends HttpException {
  constructor(message = 'Conflict') {
    super(message, 409);
    Object.setPrototypeOf(this, ConflictException.prototype);
  }
}

export class UnprocessableEntityException extends HttpException {
  constructor(message = 'Unprocessable Entity') {
    super(message, 422);
    Object.setPrototypeOf(this, UnprocessableEntityException.prototype);
  }
}

export class InternalServerErrorException extends HttpException {
  constructor(message = 'Internal Server Error') {
    super(message, 500);
    Object.setPrototypeOf(this, InternalServerErrorException.prototype);
  }
}
```

**Usage rule:** In handler catch blocks, re-throw known `HttpException` subclasses as-is. Wrap unknown errors in `InternalServerErrorException` to prevent leaking stack traces.

```typescript
} catch (error: any) {
  if (error instanceof ConflictException || error.statusCode) throw error;
  throw new InternalServerErrorException(`Context: ${error.message}`);
}
```

---

## 4. Request/Response Types

**File:** `src/backend/middleware/types.ts`

### AuthRequest

Every route handler receives an `AuthRequest` instead of a plain `NextRequest`. It carries parsed body, query params, path params, files, and the authenticated user (with their eagerly-loaded business and session record).

```typescript
import type { Business, Session, User } from '@prisma/client';
import { type NextRequest } from 'next/server';
import type z from 'zod';

export type MiddlewareResponse = {
  message: string;
  statusCode: number;
  next: boolean;
  redirect?: string;
};

export type MiddlewareFunction<B = unknown, Q = QueryParameters> = (
  req: AuthRequest<B, Q>
) => Promise<MiddlewareResponse>;

// The full user object attached to every authenticated request
export type AuthenticatedUser = User & {
  business: Business | null;
  session: Session;
};

export interface AuthRequest<B = unknown, Q = QueryParameters>
  extends NextRequest {
  parsedBody?: B;
  query?: Q;
  params?: Record<string, string>;
  files?: Record<string, File>;
  validatedData?: B;
  user: AuthenticatedUser | null;
  isExpired?: boolean;
}

export interface ValidationResult {
  message?: string;
  statusCode: number;
  next: boolean;
  validatedData?: unknown;
  errors?: z.ZodError;
}

// Union of all query validator types across the app
export type QueryParameters = BaseQueryValidatorSchema
  & /* other per-domain query schemas */ Record<string, any>;
```

### API Response Shapes

**File:** `src/types/index.ts` (create if absent)

```typescript
export interface ApiResponse<T> {
  status: number;
  message: string;
  data: T;
}

export interface PaginatedApiResponse<T> extends ApiResponse<T> {
  total: number;
  page: number;
  size: number;
  totalPages: number;
}
```

Always return one of these two shapes from every handler.

---

## 5. Middleware System

**File:** `src/backend/middleware/index.ts`

### `withMiddleware` — the route wrapper

Every exported handler must be wrapped with `withMiddleware`. It:

1. Resolves path params from Next.js `context.params`
2. Parses query string into `request.query`
3. Parses request body: JSON → `request.parsedBody`; `multipart/form-data` → `request.parsedBody` + `request.files`
4. Runs each middleware function in sequence; short-circuits on the first `{ next: false }` response
5. Calls the handler
6. On any error, captures to Sentry and returns a JSON error response using the exception's `statusCode`
7. Logs every request via `logRequest` after the response is generated

```typescript
import { db } from '@/server/db';
import { parseHttpError, logRequest } from '@/utils';
import { HttpException, UnauthorizedException } from '@/utils/exceptions';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { type z } from 'zod';
import type {
  AuthRequest,
  MiddlewareFunction,
  MiddlewareResponse,
  QueryParameters,
} from './types';

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
    req: any,
    context: { params: Promise<Record<string, string>> } | any
  ) => {
    const request = req as AuthRequest<B, Q>;
    try {
      const resolvedParams = await (context?.params ?? Promise.resolve({}));
      request.params = resolvedParams;

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
            if (value.size > 0 && value.name) files[key] = value;
          } else {
            parsedBody[key] = value;
          }
        }
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
      Sentry.captureException(error, {
        tags: { type: 'middleware_error' },
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
        error instanceof HttpException ? error.statusCode : (error.statusCode ?? 500);
      return NextResponse.json(
        { message: parseHttpError(error) ?? 'Internal server error' },
        { status: statusCode }
      );
    }

    try {
      return await handler(request, { params: request.params! });
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { type: 'handler_error' },
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
        error instanceof HttpException ? error.statusCode : (error.statusCode ?? 500);
      return NextResponse.json(
        { message: parseHttpError(error) ?? 'Internal server error' },
        { status: statusCode }
      );
    }
  };

  return async (req: any, context: any) => {
    const startTime = Date.now();
    const method = req.method;
    const url = req.nextUrl
      ? `${req.nextUrl.pathname}${req.nextUrl.search}`
      : (() => {
          const parsed = new URL(req.url);
          return `${parsed.pathname}${parsed.search}`;
        })();
    const response = await executeRequest(req, context);
    const duration = Date.now() - startTime;
    logRequest(method, url, response.status, duration, (req as AuthRequest<B, Q>).parsedBody);
    return response;
  };
};
```

### `authMiddleware`

Reads the session token from the `sara-session` httpOnly cookie (or falls back to `Authorization: Bearer <token>` for non-browser clients), validates it against the `Session` table, checks expiry, and attaches the full user record (with `business` and `session`) to `request.user`. Throws `UnauthorizedException` on any failure.

```typescript
export const authMiddleware = async <B = unknown, Q = QueryParameters>(
  request: AuthRequest<B, Q>
): Promise<MiddlewareResponse> => {
  // Cookie is the primary source; Bearer header is a fallback for API/mobile clients
  const sessionToken =
    request.cookies.get('sara-session')?.value ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();

  try {
    if (!sessionToken || sessionToken === 'undefined' || sessionToken === 'null') {
      throw new UnauthorizedException('Unauthorized');
    }

    const session = await db.session.findUnique({
      where: { sessionToken },
      include: { user: { include: { business: true } } },
    });

    if (!session) throw new UnauthorizedException('Invalid session');

    if (session.expires < new Date()) {
      await db.session.delete({ where: { id: session.id } }).catch(() => {});
      throw new UnauthorizedException('Session expired');
    }

    if (!session.user) throw new UnauthorizedException('User not found');

    request.user = { ...session.user, session };
  } catch (error: any) {
    if (error instanceof UnauthorizedException) throw error;
    throw new UnauthorizedException('Invalid auth token');
  }

  return { message: '', statusCode: 200, next: true };
};
```

### `optionalAuthMiddleware`

Same as above but does not fail when no token is present. Sets `request.user = null` and `request.isExpired = true` (on expired sessions) without throwing.

```typescript
export const optionalAuthMiddleware = async <B = unknown, Q = QueryParameters>(
  request: AuthRequest<B, Q>
): Promise<MiddlewareResponse> => {
  const sessionToken =
    request.cookies.get('sara-session')?.value ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();

  if (!sessionToken || sessionToken === 'undefined' || sessionToken === 'null') {
    request.user = null;
    return { message: '', statusCode: 200, next: true };
  }

  try {
    const session = await db.session.findUnique({
      where: { sessionToken },
      include: { user: { include: { business: true } } },
    });

    if (session && session.expires > new Date()) {
      request.user = { ...session.user, session };
    } else {
      if (session && session.expires <= new Date()) request.isExpired = true;
      request.user = null;
    }
  } catch {
    request.user = null;
  }

  return { message: '', statusCode: 200, next: true };
};
```

### `queryValidatorMiddleware`

Parses and validates the URL query string against a Zod schema. Sets `request.query` to the parsed, type-safe value. Returns 422 on validation failure.

```typescript
export const queryValidatorMiddleware =
  <Q extends z.ZodTypeAny>(schema: Q) =>
  async (request: AuthRequest<unknown, z.infer<Q>>): Promise<MiddlewareResponse> => {
    try {
      const searchParams = request.nextUrl.searchParams;
      const query: Record<string, string> = {};
      searchParams.forEach((value, key) => { query[key] = value; });
      const result = schema.safeParse(query);
      if (!result.success) {
        return {
          message: `Invalid query parameter: ${result.error.issues[0]?.message}`,
          statusCode: 422,
          next: false,
        };
      }
      request.query = result.data;
    } catch (error) {
      return { message: 'Error parsing query parameters', statusCode: 400, next: false };
    }
    return { message: '', statusCode: 200, next: true };
  };
```

### `bodyValidatorMiddleware`

Merges `request.parsedBody` and `request.files`, validates against a Zod schema, and attaches the result to `request.validatedData`. Returns 422 on failure.

```typescript
export const bodyValidatorMiddleware =
  <B extends z.ZodTypeAny>(schema: B) =>
  async (request: AuthRequest<z.infer<B>, unknown>): Promise<MiddlewareResponse> => {
    const body = request.parsedBody ?? {};
    const files = (request.files as Record<string, unknown>) ?? {};
    const dataToValidate = { ...(body as Record<string, unknown>), ...files };
    const result = schema.safeParse(dataToValidate);
    if (result.success) {
      request.validatedData = result.data;
      return { message: '', statusCode: 200, next: true };
    }
    const firstError = result.error.issues[0];
    const errorPath = firstError?.path.join('.');
    const errorMessage = firstError?.message;
    return {
      message: errorPath ? `${errorPath}: ${errorMessage}` : (errorMessage ?? 'Validation failed'),
      statusCode: 422,
      next: false,
    };
  };
```

### `pathParamValidatorMiddleware`

Validates `request.params` (path segments) against a Zod schema. Returns 422 on failure.

```typescript
export const pathParamValidatorMiddleware =
  (schema: z.ZodObject<any>) =>
  async (request: AuthRequest<any, any>): Promise<MiddlewareResponse> => {
    const result = schema.safeParse(request.params ?? {});
    if (result.success) return { message: '', statusCode: 200, next: true };
    const firstError = result.error.issues[0];
    const errorPath = firstError?.path.join('.');
    return {
      message: errorPath ? `${errorPath}: ${firstError?.message}` : (firstError?.message ?? ''),
      statusCode: 422,
      next: false,
    };
  };
```

---

## 6. Validators (Zod)

**Directory:** `src/backend/validators/`

### Naming convention

- One file per domain: `club.validator.ts`, `leaderboard.validator.ts`, etc.
- Shared pagination/base params live in `index.validator.ts`
- Every schema exports its inferred type: `export type ClubValidatorSchema = z.infer<typeof clubValidatorSchema>`

### Base query schema (pagination)

**File:** `src/backend/validators/index.validator.ts`

```typescript
import z from 'zod';

export const baseQueryValidatorSchema = z
  .object({
    page: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().int().min(1, 'page must be at least 1'))
      .default('1'),
    size: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().int().min(1).max(100, 'limit cannot exceed 100'))
      .default('10'),
    query: z.string().max(255).optional(),
    sortBy: z.enum(['name', 'createdAt', 'updatedAt']).default('createdAt').optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
    all: z
      .string()
      .transform((val) => val === 'true')
      .pipe(z.boolean())
      .optional(),
  })
  .strict();

export type BaseQueryValidatorSchema = z.infer<typeof baseQueryValidatorSchema>;
```

### Domain validator example — Club

```typescript
// src/backend/validators/club.validator.ts
import z from 'zod';
import { baseQueryValidatorSchema } from './index.validator';

export const clubValidatorSchema = z
  .object({
    name: z.string().min(3).max(80),
    slug: z.string().min(3).max(80).optional(),
    description: z.string().max(500).optional(),
    image: z.instanceof(File).optional(),
    isActive: z
      .string()
      .transform((val) => val === 'true')
      .pipe(z.boolean())
      .optional(),
    isPublic: z
      .string()
      .transform((val) => val === 'true')
      .pipe(z.boolean())
      .optional(),
  })
  .strict();

export type ClubValidatorSchema = z.infer<typeof clubValidatorSchema>;

export const updateClubValidatorSchema = clubValidatorSchema.partial();
export type UpdateClubValidatorSchema = z.infer<typeof updateClubValidatorSchema>;

export const clubQueryValidatorSchema = baseQueryValidatorSchema
  .extend({
    isActive: z
      .string()
      .transform((val) => val === 'true')
      .pipe(z.boolean())
      .optional(),
    isPublic: z
      .string()
      .transform((val) => val === 'true')
      .pipe(z.boolean())
      .optional(),
    createdById: z.string().optional(),
  })
  .strict();

export type ClubQueryValidatorSchema = z.infer<typeof clubQueryValidatorSchema>;
```

### Key Zod patterns used throughout

| Pattern | Purpose |
|---------|---------|
| `.strict()` | Reject unknown fields |
| `.transform(val => val === 'true').pipe(z.boolean())` | Coerce query-string booleans |
| `.transform(val => parseInt(val, 10)).pipe(z.number())` | Coerce query-string numbers |
| `.refine(val => new Date(val) > new Date(), 'must be future')` | Custom date validation |
| `schema.partial()` | Reuse create schema for updates |
| `z.infer<typeof schema>` | Derive TypeScript type from schema |

---

## 7. API Route Handlers

**Directory:** `src/app/api/[resource]/route.ts`

Every handler follows this exact structure:

```typescript
import {
  authMiddleware,
  bodyValidatorMiddleware,
  optionalAuthMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from '@/backend/middleware';
import { resourceValidatorSchema, type ResourceValidatorSchema } from '@/backend/validators/resource.validator';
import { db } from '@/server/db';
import { type ApiResponse, type PaginatedApiResponse } from '@/types';
import { ConflictException, InternalServerErrorException, NotFoundException } from '@/utils/exceptions';
import { NextResponse } from 'next/server';

// POST — requires auth and body validation
export const POST = withMiddleware<ResourceValidatorSchema>(
  async (request) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;

      // 1. Business logic / DB queries
      // 2. Build response
      const response: ApiResponse<Resource> = {
        status: 201,
        message: 'Resource created successfully',
        data: result,
      };
      return NextResponse.json(response, { status: 201 });
    } catch (error: any) {
      if (error instanceof ConflictException || error.statusCode) throw error;
      throw new InternalServerErrorException(`An error occurred: ${error.message}`);
    }
  },
  [authMiddleware, bodyValidatorMiddleware(resourceValidatorSchema)]
);

// GET — optional auth, query validation
export const GET = withMiddleware<unknown, ResourceQueryValidatorSchema>(
  async (request) => {
    try {
      const payload = request.query!;
      const user = request.user; // may be null

      const page = payload.page ?? 1;
      const size = payload.size ?? 10;
      const skip = (page - 1) * size;

      const [count, data] = await Promise.all([
        db.resource.count({ where }),
        db.resource.findMany({ where, take: size, skip, orderBy }),
      ]);

      const response: PaginatedApiResponse<Resource[]> = {
        status: 200,
        message: 'Resources retrieved successfully',
        data,
        total: count,
        page,
        size,
        totalPages: Math.ceil(count / size),
      };
      return NextResponse.json(response);
    } catch (error) {
      throw new InternalServerErrorException(
        `An error occurred: ${(error as Error).message}`
      );
    }
  },
  [optionalAuthMiddleware, queryValidatorMiddleware(resourceQueryValidatorSchema)]
);
```

### Nested routes (by ID)

**File:** `src/app/api/[resource]/[id]/route.ts`

```typescript
import { mongoIdValidator } from '@/utils';
import { pathParamValidatorMiddleware } from '@/backend/middleware';
import z from 'zod';

const idParamSchema = z.object({ id: mongoIdValidator });

export const GET = withMiddleware(
  async (request) => {
    const { id } = request.params!;
    const resource = await db.resource.findUnique({ where: { id } });
    if (!resource) throw new NotFoundException('Resource not found');
    const response: ApiResponse<Resource> = {
      status: 200,
      message: 'Resource retrieved successfully',
      data: resource,
    };
    return NextResponse.json(response);
  },
  [optionalAuthMiddleware, pathParamValidatorMiddleware(idParamSchema)]
);

export const PUT = withMiddleware<UpdateResourceValidatorSchema>(
  async (request) => {
    const { id } = request.params!;
    const payload = request.validatedData!;
    const user = request.user!;
    // check ownership, update, return
  },
  [authMiddleware, pathParamValidatorMiddleware(idParamSchema), bodyValidatorMiddleware(updateResourceValidatorSchema)]
);

export const DELETE = withMiddleware(
  async (request) => {
    const { id } = request.params!;
    const user = request.user!;
    // check ownership, delete, return 204
  },
  [authMiddleware, pathParamValidatorMiddleware(idParamSchema)]
);
```

---

## 8. Services Layer

**Directory:** `src/backend/services/[domain]/index.ts`

### Pattern: class-based singleton

```typescript
class ResourceService {
  async findById(id: string) {
    return db.resource.findUnique({ where: { id } });
  }

  async create(data: CreateResourceInput) {
    return db.resource.create({ data });
  }
}

export const resourceService = new ResourceService();
```

- Export the instantiated singleton, not the class
- Services never import from `@/app/api/` — only from `@/server/db`, other services, or third-party SDKs
- Services throw `HttpException` subclasses for business-rule failures
- Multi-step DB operations use `db.$transaction([...])` for atomicity

`availabilityService`, `emailService`, and `googleCalendarService` follow this same singleton pattern — see §15 and §16 for what each one exposes.

### Session creation pattern

```typescript
import { randomBytes } from 'crypto';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SESSION_COOKIE_NAME = 'sara-session';

const createUserSession = async (userId: string) => {
  const sessionToken = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await db.session.create({ data: { sessionToken, userId, expires } });
  return sessionToken;
};

// Set the httpOnly cookie on a NextResponse
const setSessionCookie = (response: NextResponse, sessionToken: string) => {
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
};
```

---

## 9. Database (Prisma)

**File:** `src/server/db.ts`

```typescript
import { PrismaClient } from '@prisma/client';

const createPrismaClient = () =>
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

const globalForPrisma = globalThis as unknown as { prisma: ReturnType<typeof createPrismaClient> };

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
```

The `globalThis` singleton prevents hot-reload from opening multiple connections in development.

### Query conventions

- Always use `Promise.all([db.entity.count(...), db.entity.findMany(...)])` for paginated queries — run them in parallel
- Use `db.$transaction([...])` for any multi-step write
- Prefer explicit `.select()` / `.include()` over fetching full rows
- IDs are MongoDB ObjectIds: validated with `mongoIdValidator` from `@/utils`

### Typed Prisma objects (type-safety rule)

**Always** declare Prisma operation objects with an explicit `Prisma.*` type before passing them to a query. Never construct `where`, `data`, `orderBy`, `include`, or `select` objects inline without a type annotation — TypeScript will silently accept unknown fields.

Import the namespace once at the top of every file that touches the DB:

```typescript
import type { Prisma } from '@prisma/client';
```

#### Mutation inputs — `CreateInput` / `UpdateInput`

```typescript
// ✅ type-safe: TS catches any field that doesn't exist on the model
const data: Prisma.UserCreateInput = {
  fullname,
  email,
  access_token: token,
  lastLoginAt: new Date(),
};
await db.user.create({ data });

// For updates, use UpdateInput
const data: Prisma.UserUpdateInput = {
  fullname,
  lastLoginAt: new Date(),
};
await db.user.update({ where: { id }, data });
```

#### Where clauses — `WhereInput`

```typescript
const where: Prisma.LeaderboardWhereInput = {
  isActive: true,
  clubId,
};

// Build conditionally — mutation is safe because the type is declared
if (query) {
  where.name = { contains: query, mode: 'insensitive' };
}

const visibilityCondition: Prisma.LeaderboardWhereInput = {
  OR: [{ isPublic: true }, { createdById: userId }],
};
(where.AND as Prisma.LeaderboardWhereInput[]) = [visibilityCondition];
```

#### OrderBy — `OrderByWithRelationInput`

```typescript
const orderBy: Prisma.LeaderboardOrderByWithRelationInput = {
  createdAt: 'desc',
};
```

#### Include / Select — `EntityInclude`

```typescript
const include: Prisma.LeaderboardInclude = {
  club: { select: { id: true, name: true, slug: true, image: true } },
  _count: { select: { entries: true } },
};
```

#### Full query args — `EntityFindUniqueArgs` / `EntityFindManyArgs`

Use the `Args` types when you want to type the entire query object in one go:

```typescript
const queryArgs: Prisma.UserFindUniqueArgs = {
  where: { id },
  select: { id: true, email: true, fullname: true, avatar: true },
};
const user = await db.user.findUnique(queryArgs);
```

#### Transaction arrays — `PrismaPromise<unknown>[]`

```typescript
const ops: Prisma.PrismaPromise<unknown>[] = [];

ops.push(
  db.userClub.create({ data: { userId, clubId, role: 'MEMBER' } }),
  db.club.update({ where: { id: clubId }, data: { memberCount: { increment: 1 } } }),
);

await db.$transaction(ops);
```

#### Return-type narrowing with `Pick`

When a query uses `.select()`, narrow the return type with `Pick<Model, ...>` so callers get the exact shape:

```typescript
async findOrCreateUser(...): Promise<Pick<User, 'id' | 'email' | 'fullname' | 'avatar'>> {
  return db.user.findFirst({
    where: { email },
    select: { id: true, email: true, fullname: true, avatar: true },
  });
}
```

#### Quick reference

| Object | Prisma type |
|--------|------------|
| `data` for create | `Prisma.EntityCreateInput` |
| `data` for update | `Prisma.EntityUpdateInput` |
| `where` clause | `Prisma.EntityWhereInput` |
| `orderBy` | `Prisma.EntityOrderByWithRelationInput` |
| `include` | `Prisma.EntityInclude` |
| Full query args | `Prisma.EntityFindUniqueArgs` / `Prisma.EntityFindManyArgs` |
| Transaction list | `Prisma.PrismaPromise<unknown>[]` |
| Narrowed return | `Pick<Entity, 'field1' \| 'field2'>` |

---

## 10. Auth (Cookie Sessions + OAuth)

**File:** `src/backend/services/auth/index.ts`

- Strategy: **database-backed sessions** via an httpOnly cookie (`sara-session`)
- Session tokens are cryptographically random 32-byte strings (not JWTs — no payload to decode, every request hits the DB)
- OAuth providers (Google, Facebook, Instagram) are handled manually in `AuthService` — no NextAuth at runtime

### Prisma models

```prisma
model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String         // "google" | "facebook" | "instagram"
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}
```

### OAuth + session flow

| Step | Route | What happens |
|------|-------|-------------|
| 1 | `GET /api/auth/[provider]` | Redirect user to OAuth authorization URL |
| 2 | `GET /api/auth/[provider]/callback` | Exchange code → token → user profile; find-or-create `User` + `Account`; call `createUserSession` |
| 3 | `AuthService.createUserSession(userId)` | Insert `Session` row with random token and 30-day expiry; return token |
| 4 | `setSessionCookie(response, token)` | Set `sara-session` httpOnly cookie on the redirect response |
| 5 | Subsequent requests | `authMiddleware` reads cookie, validates against `Session` table, attaches `request.user` |
| 6 | `POST /api/auth/logout` | Delete session row from DB; clear cookie |

### `AuthService` class pattern

```typescript
// src/backend/services/auth/index.ts
import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { db } from '@/server/db';

class AuthService {
  private readonly sessionMaxAgeSeconds = 60 * 60 * 24 * 30;
  private readonly cookieName = 'sara-session';

  async createCallbackResponse(request: NextRequest, providerId: Provider) {
    const code = request.nextUrl.searchParams.get('code')!;
    const tokenSet = await this.exchangeCodeForToken(providerId, code, request);
    const profile = await this.fetchProviderProfile(providerId, tokenSet);
    const user = await this.findOrCreateOAuthUser(providerId, profile, tokenSet);
    const sessionToken = await this.createUserSession(user.id);

    const response = NextResponse.redirect(new URL('/home', request.url));
    this.setSessionCookie(response, sessionToken);
    return response;
  }

  private async createUserSession(userId: string) {
    const sessionToken = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + this.sessionMaxAgeSeconds * 1000);
    await db.session.create({ data: { sessionToken, userId, expires } });
    return sessionToken;
  }

  private setSessionCookie(response: NextResponse, sessionToken: string) {
    response.cookies.set(this.cookieName, sessionToken, {
      httpOnly: true,
      maxAge: this.sessionMaxAgeSeconds,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
}

export const authService = new AuthService();
```

### Logout route

```typescript
// src/app/api/auth/logout/route.ts
export const POST = async (request: NextRequest) => {
  const sessionToken = request.cookies.get('sara-session')?.value;
  if (sessionToken) {
    await db.session.deleteMany({ where: { sessionToken } });
  }
  const response = NextResponse.redirect(new URL('/', request.url), { status: 303 });
  response.cookies.delete('sara-session');
  return response;
};
```

### Client usage

Cookies are sent automatically by the browser. No `Authorization` header is needed in browser clients. For API/mobile clients pass the session token as a Bearer header:

```typescript
// Browser — cookie is attached automatically, no extra header
fetch('/api/resource');

// Mobile / server-side — use the session token as Bearer
fetch('/api/resource', {
  headers: { Authorization: `Bearer ${sessionToken}` },
});
```

---

## 11. Logging

**File:** `src/utils/index.ts` → `logRequest`

Logging is automatic — `withMiddleware` calls it after every response. Do not call it manually in handlers.

```typescript
export const logRequest = (
  method: string,
  url: string,
  statusCode: number,
  duration: number,
  payload?: any
) => {
  let statusColor = '\x1b[32m';         // green  2xx
  if (statusCode >= 300) statusColor = '\x1b[36m'; // cyan   3xx
  if (statusCode >= 400) statusColor = '\x1b[33m'; // yellow 4xx
  if (statusCode >= 500) statusColor = '\x1b[31m'; // red    5xx
  const resetColor = '\x1b[0m';

  const message = `${method} ${url} ${statusColor}${statusCode}${resetColor} - ${duration}ms`;

  if (statusCode >= 500) {
    console.error(message);
  } else {
    console.log(message);
  }

  if (payload && Object.keys(payload).length > 0) {
    const sanitized = JSON.parse(JSON.stringify(payload));
    ['password', 'token', 'creditCard'].forEach((key) => {
      if (sanitized[key]) sanitized[key] = '*****';
    });
    console.debug(`Payload: ${JSON.stringify(sanitized)}`);
  }
};
```

Errors are also captured to Sentry inside `withMiddleware` with the tags `type: 'middleware_error'` or `type: 'handler_error'` and user/request context.

---

## 12. Utility Helpers

**File:** `src/utils/index.ts`

```typescript
import z from 'zod';
import bcrypt from 'bcryptjs';
import { HttpException } from './exceptions';

// MongoDB 24-char hex ID validator — use in pathParamValidatorMiddleware schemas
export const mongoIdValidator = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ID format');

// Extract a human-readable message from any thrown value
export function parseHttpError(error: any): string | undefined {
  if (error instanceof HttpException || error.statusCode) return error.message;
  return error?.response?.message ?? error?.cause ?? error?.toString();
}

// Password hashing
export const hashPassword = async (payload: string) => bcrypt.hash(payload, 10);
export const verifyPassword = async (payload: string, hash: string) =>
  bcrypt.compare(payload, hash);

// Format total minutes → "1h 23m" or "45m"
export function formatDuration(minutes: number | null): string {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Convert all undefined values in an object to null (useful before JSON serialization)
export function undefinedToNull<T extends object>(obj: T) {
  const result: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result[key] = obj[key] === undefined ? null : obj[key];
    }
  }
  return result as { [K in keyof T]: T[K] | null };
}
```

---

## 13. Global Next.js Middleware

**File:** `src/middleware.ts`

This runs at the edge for every request — before any route handler. Use it for route guards and URL rewrites.

```typescript
import { auth } from '@/server/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_ROUTES = ['/login', '/register', '/invites'];
const PROTECTED_ROUTES = ['/home', '/settings', '/notifications'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Rewrite /@username → /profile/username
  if (pathname.startsWith('/@')) {
    const username = pathname.slice(2);
    return NextResponse.rewrite(new URL(`/profile/${username}`, req.url));
  }

  const session = await auth();
  const isProtected = PROTECTED_ROUTES.some((r) => pathname.startsWith(r));

  if (isProtected && !session) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
};
```

---

## 14. End-to-End Request Flow

### Example: `POST /api/services`

```
Client (browser)
  │
  │  POST /api/services
  │  Content-Type: application/json
  │  Cookie: sara-session=<sessionToken>   ← set automatically by browser
  │  Body: { name, description, price }
  ▼
src/middleware.ts (edge)
  │  Not a protected page route → NextResponse.next()
  ▼
src/app/api/services/route.ts → export const POST = withMiddleware(handler, [authMiddleware, bodyValidatorMiddleware(serviceValidatorSchema)])
  │
  ├─ withMiddleware parses JSON body → request.parsedBody = { name, description, price }
  │
  ├─ authMiddleware
  │    reads request.cookies.get('sara-session')
  │    db.session.findUnique({ where: { sessionToken }, include: { user: { include: { business: true } } } })
  │    checks session.expires > new Date()
  │    attaches request.user = { ...session.user, business, session }
  │
  ├─ bodyValidatorMiddleware(serviceValidatorSchema)
  │    validates request.parsedBody → attaches request.validatedData
  │
  ├─ handler(request)
  │    const payload = request.validatedData!
  │    const { business } = request.user!   // business is always loaded
  │    db.service.create({ data: { ...payload, businessId: business.id } })
  │    return NextResponse.json({ status: 201, message, data: service }, { status: 201 })
  │
  ├─ withMiddleware catches any thrown HttpException
  │    → returns NextResponse.json({ message }, { status: error.statusCode })
  │
  └─ logRequest('POST', '/api/services', 201, 38ms, payload)

Client receives:
  { status: 201, message: 'Service created successfully', data: { id, name, ... } }
```

### OAuth sign-in flow

```
Client
  │  GET /api/auth/google
  ▼
AuthService.createAuthorizationResponse()
  │  Redirects → Google OAuth consent screen
  ▼
Google → GET /api/auth/google/callback?code=...&state=...
  ▼
AuthService.createCallbackResponse()
  ├─ Exchanges code for access token
  ├─ Fetches user profile from Google
  ├─ db.user.upsert / db.account.upsert
  ├─ randomBytes(32).toString('base64url') → sessionToken
  ├─ db.session.create({ sessionToken, userId, expires: +30d })
  └─ Sets Cookie: sara-session=<sessionToken>; HttpOnly; SameSite=Lax; Secure
  ▼
Client is redirected to /home with cookie set
```

---

## 15. Scheduling & Availability

**Directory:** `src/backend/services/availability/index.ts`

Single entry point for "what slots are bookable":

```typescript
getAvailableSlots(params: {
  businessId: string;
  serviceId: string;
  date: string; // "YYYY-MM-DD"
}): Promise<{ startTime: Date; endTime: Date; isAvailable: boolean }[]>
```

It generates every candidate slot across the service's window for that date (stepping by `service.duration` minutes) and flags each one `isAvailable` by intersecting, in order:

1. `BusinessHours` for the date's day of week. No rows for a business means the day is open all day — this is the default/legacy behavior, not an error state.
2. `BusinessClosure` for the exact date — a match marks every slot that day unavailable.
3. The service's own `availableFrom`/`availableTo` window (this bounds which candidates are generated at all, same as before this feature existed).
4. Existing `PENDING`/`CONFIRMED` bookings for the **business** (not just the service — see Convention #18 below; one business is one provider with one calendar).
5. Busy intervals on the business's connected Google Calendar, via `googleCalendar.getBusyIntervals` (§16) — skipped entirely when no calendar is connected.

Returning every candidate with a flag — rather than only the open ones — is what lets `GET /api/services/[slug]?date=YYYY-MM-DD` keep its existing response shape (`ServiceDetail.slots: TimeSlot[]`, each with `isAvailable`). That route is **retrofitted**, not new: it already had its own local `generateTimeSlots()` and a serviceId-scoped conflict check before this feature existed; both are replaced by a call to `getAvailableSlots()`. A consumer that only wants bookable times calls `.filter(s => s.isAvailable)`.

`BusinessHours` and `BusinessClosure` are plain Prisma models, managed through their own routes:

- `GET` / `PUT /api/business/hours` — read/replace the full 7-day week in one call.
- `GET` / `POST /api/business/closures`, `DELETE /api/business/closures/[id]` — list/add/remove one-off closures (holidays, vacation days).

The module takes no `request`/auth dependency, so a future unauthenticated public booking page can call `getAvailableSlots` directly without any change to the function itself — only a new route with a different middleware stack.

## 16. Google Calendar Integration

**Directory:** `src/backend/services/googleCalendar/index.ts`

A business owner connects their Google Calendar independently of how they log in. This uses its own OAuth consent screen with narrow, purpose-specific scopes — `calendar.events` and `calendar.freebusy` — never the broad `calendar` scope, and never the login flow's `openid email profile` scopes (§10).

```
Client (business owner, authenticated)
  │  GET /api/business/google-calendar/connect
  ▼
googleCalendarService.getAuthorizationUrl(state)
  │  Redirects → Google OAuth consent screen (calendar.events + calendar.freebusy)
  ▼
Google → GET /api/business/google-calendar/callback?code=...&state=...
  ▼
googleCalendarService.exchangeCodeForTokens(code)
  └─ db.business.update({ googleCalendarAccessToken, googleCalendarRefreshToken, googleCalendarTokenExpiry, googleCalendarConnectedAt })
```

Tokens live as flat fields on `Business` (`googleCalendarAccessToken`, `googleCalendarRefreshToken`, `googleCalendarTokenExpiry`, `googleCalendarId`, `googleCalendarConnectedAt`) — the same convention as `paystackSubaccountCode`/`monoAccountId`, not a separate table. `ensureFreshAccessToken(business)` checks `googleCalendarTokenExpiry` and refreshes via the stored refresh token before any API call, persisting the new access token/expiry back onto `Business`.

```typescript
createEvent(business, booking, service): Promise<{ googleEventId: string }>
updateEvent(business, booking, service): Promise<void>
deleteEvent(business, googleEventId): Promise<void>
getBusyIntervals(business, date): Promise<{ start: Date; end: Date }[]> // [] if not connected or on error
```

`createEvent`/`updateEvent`/`deleteEvent` are called from the booking lifecycle (Paystack webhook on confirm, `PUT`/`DELETE /api/bookings/[slug]` on reschedule/cancel). `getBusyIntervals` is called from `getAvailableSlots` (§15) at slot-calculation time — there is no background sync job or webhook listener; Calendar is always read live, on demand, which is what keeps this integration simple (see Convention #20).

`DELETE /api/business/google-calendar` revokes the token at Google and clears the stored fields, disconnecting the calendar.

---

## 17. Conventions & Rules

1. **Every route handler** is wrapped in `withMiddleware`. No bare `export async function GET`.

2. **Middleware order matters.** Always: auth middleware first, then validator middleware.
   ```typescript
   [authMiddleware, bodyValidatorMiddleware(schema)]
   [optionalAuthMiddleware, queryValidatorMiddleware(schema)]
   [authMiddleware, pathParamValidatorMiddleware(schema), bodyValidatorMiddleware(schema)]
   ```

3. **Handler catch blocks** follow this pattern — never swallow errors silently:
   ```typescript
   } catch (error: any) {
     if (error instanceof SomeKnownException || error.statusCode) throw error;
     throw new InternalServerErrorException(`Context: ${error.message}`);
   }
   ```

4. **Never return raw error details** to the client. Always use exception classes whose `message` is already user-safe.

5. **Validators are strict** — `.strict()` on every Zod object schema to reject unknown fields.

6. **Boolean query params** are strings on the wire. Always coerce: `.transform(val => val === 'true').pipe(z.boolean())`.

7. **Pagination** always runs `count` and `findMany` in `Promise.all`. Return `{ total, page, size, totalPages }` in every list response.

8. **Services** are the only place database calls live. Route handlers import services or `db` directly — not both.

9. **Types flow from Zod.** Never write a TypeScript interface for a request body — derive it with `z.infer<typeof schema>`.

10. **Do not log inside handlers.** `withMiddleware` handles request logging automatically.

11. **Prisma singleton** uses the `globalThis` pattern to survive hot-reload in development.

12. **Sentry** is only called inside `withMiddleware`, never in handlers or services.

13. **Prisma objects are always explicitly typed** using the `Prisma.*` namespace (e.g., `Prisma.UserCreateInput`, `Prisma.LeaderboardWhereInput`). Never pass an untyped object literal directly to a Prisma method — declare the variable with its type first. Import the namespace as `import type { Prisma } from '@prisma/client'` in every file that performs DB operations. Narrow query return types with `Pick<Model, 'field'>` when `.select()` is used.

14. **Session tokens are random bytes, not JWTs.** Generate with `randomBytes(32).toString('base64url')`. Never use `jwt.sign` for sessions — there is no payload to decode; every request validates the token against the `Session` table.

15. **httpOnly cookie is the auth transport.** Set with `sameSite: 'lax'` and `secure: true` in production. The cookie name is `sara-session`. Never store the session token in `localStorage`.

16. **`request.user` includes business.** `authMiddleware` eagerly loads `user.business`. Handlers can access `request.user!.business` directly without a second DB query.

17. **Session cleanup on expiry.** `authMiddleware` deletes expired sessions before throwing `UnauthorizedException`. No background job needed — cleanup is lazy, on next use.

18. **Booking conflict checks are businessId-scoped, not serviceId-scoped.** A business is a single provider with a single calendar — two different services on the same business cannot run at the same time. Every overlap check (`POST /api/bookings`, the reschedule path in `PUT /api/bookings/[slug]`, and `getAvailableSlots`) filters by `businessId`.

19. **Cron routes use a shared-secret check, not `authMiddleware`.** There is no user in a cron request. Routes like `GET /api/cron/booking-reminders` still use `withMiddleware(handler, [])` — an empty middleware array — for the usual JSON parsing/logging/error-mapping, but the handler itself compares the `Authorization` header against `env.CRON_SECRET` as its first step and throws `UnauthorizedException` on mismatch, rather than delegating that check to `authMiddleware`.

20. **External integration calls are best-effort and non-fatal.** Atlas routing, Google Calendar sync, and notification emails are all side effects of a booking operation, never a precondition for it. A failure in any of them is logged and swallowed — it never fails the booking create/cancel/reschedule that triggered it.

21. **Optional configuration degrades to today's behavior, not an error.** No `BusinessHours` rows, no `BusinessClosure` rows, and no Google Calendar connection are all valid default states. Every scheduling feature checks for the absence of configuration and falls back to the simpler prior behavior rather than requiring setup before it works at all.

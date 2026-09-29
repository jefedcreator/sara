import { encode } from "next-auth/jwt";
import { vi } from "vitest";

import { env } from "@/env";

import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/server/auth/shared";

/**
 * Builds a minimal NextRequest-shaped object sufficient for withMiddleware's
 * executeRequest to parse (cookies, headers, json body, query string).
 */
export function createMockRequest({
  method = "GET",
  url = "http://localhost:3000/api/test",
  cookies = {},
  headers = {},
  body,
}: {
  method?: string;
  url?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
} = {}) {
  const headerMap = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const parsedUrl = new URL(url);

  return {
    method,
    url,
    nextUrl: parsedUrl,
    cookies: {
      get: (name: string) =>
        cookies[name] !== undefined ? { value: cookies[name] } : undefined,
    },
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
    },
    json: async () => body ?? null,
    formData: async () => new FormData(),
  } as any;
}

const MOCK_SESSION_ID = "session_1";
const MOCK_USER_ID = "mock-user";

/** A real session JWT naming MOCK_SESSION_ID, as authMiddleware expects. */
export const MOCK_SESSION_TOKEN = await encode({
  token: { sub: MOCK_USER_ID, sessionId: MOCK_SESSION_ID },
  // vitest.config.ts sets the secret; the fallback covers tests that mock
  // `@/env` without one and never authenticate.
  secret: env.AUTH_SECRET ?? "test-auth-secret",
  salt: SESSION_COOKIE,
  maxAge: SESSION_MAX_AGE_SECONDS,
});

/**
 * Configures a mocked `db.session.findUnique` (as used by authMiddleware) to
 * resolve to a valid, non-expired session for the given user/business.
 */
export function mockAuthenticatedSession(
  mockedDb: { session: { findUnique: ReturnType<typeof vi.fn> } },
  { user, business }: { user: Record<string, unknown>; business: unknown },
) {
  mockedDb.session.findUnique.mockResolvedValue({
    id: MOCK_SESSION_ID,
    userId: MOCK_USER_ID,
    expires: new Date(Date.now() + 1000 * 60 * 60),
    user: { ...user, business },
  });
}

export function authenticatedCookies() {
  return { [SESSION_COOKIE]: MOCK_SESSION_TOKEN };
}

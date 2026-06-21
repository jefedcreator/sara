import { vi } from "vitest";

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

/** Default session token used by tests that call mockAuthenticatedSession. */
export const MOCK_SESSION_TOKEN = "mock-session-token";

/**
 * Configures a mocked `db.session.findUnique` (as used by authMiddleware) to
 * resolve to a valid, non-expired session for the given user/business.
 */
export function mockAuthenticatedSession(
  mockedDb: { session: { findUnique: ReturnType<typeof vi.fn> } },
  { user, business }: { user: Record<string, unknown>; business: unknown },
) {
  mockedDb.session.findUnique.mockResolvedValue({
    id: "session_1",
    sessionToken: MOCK_SESSION_TOKEN,
    expires: new Date(Date.now() + 1000 * 60 * 60),
    user: { ...user, business },
  });
}

export function authenticatedCookies() {
  return { "sara-session": MOCK_SESSION_TOKEN };
}

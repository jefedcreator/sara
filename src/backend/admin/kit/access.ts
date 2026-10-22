import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '@/env';

// Spec §5: one bearer token, CORS for the dashboard's origin only, no caching.

const BEARER = /^Bearer (.+)$/;

const PREFLIGHT_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '600',
};

/** The admin token, or null when the admin is off. */
function adminToken(): string | null {
  const token = env.ADMIN_API_TOKEN;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/** Off until `ADMIN_API_TOKEN` is set; off answers every admin request 404. */
export function adminEnabled(): boolean {
  return adminToken() !== null;
}

/** `Bearer <token>`, compared in constant time: SHA-256 both, then compare. */
export function tokenMatches(authorization: string | null): boolean {
  const token = adminToken();
  if (token === null || authorization === null) return false;
  const given = BEARER.exec(authorization)?.[1];
  if (given === undefined) return false;
  return timingSafeEqual(sha256(given), sha256(token));
}

/** `Vary: Origin` always, and the allowed origin only on an exact match. */
export function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({ Vary: 'Origin' });
  if (origin !== null && origin === env.ADMIN_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return headers;
}

/** A copy of the response with the CORS and no-store headers set. */
export function withAdminHeaders(
  request: Request,
  response: Response
): Response {
  const headers = new Headers(response.headers);
  corsHeaders(request.headers.get('Origin')).forEach((value, name) => {
    if (name !== 'vary') {
      headers.set(name, value);
    } else if (!/\borigin\b/i.test(headers.get('Vary') ?? '')) {
      // Adds Origin to any Vary the handler set, rather than replacing it.
      headers.append('Vary', value);
    }
  });
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** `OPTIONS` on every admin path: 204 without the token, 404 when off. */
export function adminPreflight(request: Request): Response {
  if (!adminEnabled()) {
    return withAdminHeaders(request, new Response(null, { status: 404 }));
  }
  return withAdminHeaders(
    request,
    new Response(null, { status: 204, headers: PREFLIGHT_HEADERS })
  );
}

/** Wraps a route handler so every response it gives carries the admin headers. */
export function adminRoute<C>(
  handler: (request: Request, context: C) => Promise<Response>
): (request: Request, context: C) => Promise<Response> {
  return async (request, context) =>
    withAdminHeaders(request, await handler(request, context));
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

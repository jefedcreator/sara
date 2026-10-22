import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminEnabled,
  adminPreflight,
  adminRoute,
  corsHeaders,
  tokenMatches,
  withAdminHeaders,
} from '../access';

const env = vi.hoisted(() => {
  const values: {
    ADMIN_API_TOKEN: string | undefined;
    ADMIN_ORIGIN: string | undefined;
  } = { ADMIN_API_TOKEN: undefined, ADMIN_ORIGIN: undefined };
  return values;
});

vi.mock('@/env', () => ({ env }));

const TOKEN = 'k3J9xQ2mV8pL4wR7tY1uZ6aB0cD5eF9gH2iJ8kL3mN4=';
const ORIGIN = 'https://admin.interacti.test';
const ENDPOINT = 'https://strive.test/api/admin/clubs';

function request(method: string, origin?: string): Request {
  const headers = new Headers();
  if (origin !== undefined) headers.set('Origin', origin);
  return new Request(ENDPOINT, { method, headers });
}

beforeEach(() => {
  env.ADMIN_API_TOKEN = TOKEN;
  env.ADMIN_ORIGIN = ORIGIN;
});

describe('with no token set', () => {
  beforeEach(() => {
    env.ADMIN_API_TOKEN = undefined;
  });

  it('is off, and its preflight answers 404', () => {
    expect(adminEnabled()).toBe(false);
    expect(adminPreflight(request('OPTIONS', ORIGIN)).status).toBe(404);
  });

  it('matches no token at all', () => {
    expect(tokenMatches(`Bearer ${TOKEN}`)).toBe(false);
    expect(tokenMatches('Bearer ')).toBe(false);
  });
});

describe('with a token set', () => {
  it('is on', () => {
    expect(adminEnabled()).toBe(true);
  });

  it('matches only the exact bearer token', () => {
    expect(tokenMatches(`Bearer ${TOKEN}`)).toBe(true);
    expect(tokenMatches(`Bearer ${TOKEN}x`)).toBe(false);
    expect(tokenMatches('Bearer wrong')).toBe(false);
    expect(tokenMatches(null)).toBe(false);
    expect(tokenMatches('Bearer ')).toBe(false);
    expect(tokenMatches(TOKEN)).toBe(false);
    expect(tokenMatches(`Basic ${TOKEN}`)).toBe(false);
  });

  it('answers a preflight 204 with the allowed methods and headers', () => {
    const response = adminPreflight(request('OPTIONS', ORIGIN));
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST, PUT, DELETE, OPTIONS'
    );
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Authorization, Content-Type'
    );
    expect(response.headers.get('Access-Control-Max-Age')).toBe('600');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('allows the dashboard origin only on an exact match', () => {
    expect(corsHeaders(ORIGIN).get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(
      corsHeaders('https://evil.test').get('Access-Control-Allow-Origin')
    ).toBeNull();
    expect(
      corsHeaders(`${ORIGIN}.evil.test`).get('Access-Control-Allow-Origin')
    ).toBeNull();
    expect(corsHeaders(null).get('Access-Control-Allow-Origin')).toBeNull();
    expect(corsHeaders(null).get('Vary')).toBe('Origin');
    const preflight = adminPreflight(request('OPTIONS', 'https://evil.test'));
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('allows no origin when ADMIN_ORIGIN is unset', () => {
    env.ADMIN_ORIGIN = undefined;
    expect(corsHeaders(ORIGIN).get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('withAdminHeaders', () => {
  it('adds Vary and no-store to any response, a 500 included', async () => {
    const response = withAdminHeaders(
      request('GET', ORIGIN),
      new Response(JSON.stringify({ message: 'boom' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    expect(response.status).toBe(500);
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await response.text()).toBe('{"message":"boom"}');
  });

  it('adds Origin to a Vary the response already has', () => {
    const response = withAdminHeaders(
      request('GET'),
      new Response(null, { status: 404, headers: { Vary: 'Accept-Encoding' } })
    );
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Origin');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('adminRoute', () => {
  it('passes the handler its arguments and adds the headers', async () => {
    const route = adminRoute(
      (_request: Request, context: { params: Promise<{ key: string }> }) =>
        context.params.then(
          (params) => new Response(params.key, { status: 201 })
        )
    );
    const response = await route(request('POST', ORIGIN), {
      params: Promise.resolve({ key: 'c1' }),
    });
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('c1');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Vary')).toBe('Origin');
  });
});

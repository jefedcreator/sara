import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@/utils/exceptions';
import {
  ANALYTICS_DAYS,
  createAnalytics,
  parseAnalyticsQuery,
  readAnalytics,
} from '../analytics';

const env = vi.hoisted(() => {
  const values: {
    GA_PROPERTY_ID?: string;
    GA_SERVICE_ACCOUNT_B64?: string;
    GA_ENQUIRY_EVENT?: string;
  } = {};
  return values;
});

vi.mock('@/env', () => ({ env }));

const VALID_SA = {
  client_email: 'analytics@example.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC5\n-----END PRIVATE KEY-----\n',
};
const VALID_SA_B64 = Buffer.from(JSON.stringify(VALID_SA)).toString('base64');
const VALID_PROPERTY_ID = '123456789';

interface ReportRowInput {
  dimensions?: string[];
  metrics: (number | string)[];
}

interface ReportOptions {
  rows?: ReportRowInput[];
  headers?: {
    metrics?: string[];
    dimensions?: string[];
  } | string[];
  timeZone?: string;
}

function report({
  rows = [],
  headers,
  timeZone = 'UTC',
}: ReportOptions = {}) {
  let metricHeaderNames: string[] = ['activeUsers', 'screenPageViews'];
  let dimensionHeaderNames: string[] = [];

  if (Array.isArray(headers)) {
    metricHeaderNames = headers;
  } else if (headers) {
    if (headers.metrics) metricHeaderNames = headers.metrics;
    if (headers.dimensions) dimensionHeaderNames = headers.dimensions;
  }

  return {
    metricHeaders: metricHeaderNames.map((name) => ({ name, type: 'TYPE_INTEGER' })),
    dimensionHeaders: dimensionHeaderNames.map((name) => ({ name })),
    rows: rows.map((r) => ({
      dimensionValues: r.dimensions?.map((value) => ({ value })),
      metricValues: r.metrics.map((value) => ({ value: String(value) })),
    })),
    metadata: { timeZone },
  };
}

function mockResponse(reports: ReturnType<typeof report>[], timeZone = 'UTC', status = 200) {
  return new Response(
    JSON.stringify({
      reports,
      metadata: { timeZone },
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

describe('analytics kit', () => {
  beforeEach(() => {
    env.GA_PROPERTY_ID = VALID_PROPERTY_ID;
    env.GA_SERVICE_ACCOUNT_B64 = VALID_SA_B64;
    env.GA_ENQUIRY_EVENT = undefined;
  });

  describe('query parsing', () => {
    it('parseAnalyticsQuery accepts 7, 30 and 90', () => {
      expect(ANALYTICS_DAYS).toEqual([7, 30, 90]);
      expect(parseAnalyticsQuery(new URLSearchParams('days=7'))).toEqual({ days: 7 });
      expect(parseAnalyticsQuery(new URLSearchParams('days=30'))).toEqual({ days: 30 });
      expect(parseAnalyticsQuery(new URLSearchParams('days=90'))).toEqual({ days: 90 });
    });

    it('parseAnalyticsQuery names the first offending parameter', () => {
      expect(parseAnalyticsQuery(new URLSearchParams(''))).toEqual({ error: 'days' });
      expect(parseAnalyticsQuery(new URLSearchParams('days=5'))).toEqual({ error: 'days' });
      expect(parseAnalyticsQuery(new URLSearchParams('days=abc'))).toEqual({ error: 'days' });
      expect(parseAnalyticsQuery(new URLSearchParams('days=30&days=7'))).toEqual({ error: 'days' });
      expect(parseAnalyticsQuery(new URLSearchParams('days=7&x=1'))).toEqual({ error: 'x' });
      expect(parseAnalyticsQuery(new URLSearchParams('y=2&days=7&x=1'))).toEqual({ error: 'y' });
    });
  });

  describe('GA requests and responses', () => {
    it('asks Google for totals with no dimension and for the series by date', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse([
          report({
            headers: { dimensions: ['dateRange'], metrics: ['activeUsers', 'screenPageViews'] },
            rows: [
              { dimensions: ['date_range_0'], metrics: [100, 200] },
              { dimensions: ['date_range_1'], metrics: [50, 80] },
            ],
          }),
          report({
            headers: { dimensions: ['date'], metrics: ['activeUsers', 'screenPageViews'] },
            rows: [{ dimensions: ['20261022'], metrics: [10, 20] }],
          }),
        ])
      );
      const accessTokenMock = vi.fn().mockResolvedValue('token-123');

      const analytics = createAnalytics(
        { GA_PROPERTY_ID: VALID_PROPERTY_ID, GA_SERVICE_ACCOUNT_B64: VALID_SA_B64 },
        { fetch: fetchMock as any, accessToken: accessTokenMock, now: () => new Date('2026-10-23T12:00:00Z') }
      );

      const res = await analytics.read(30);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0]!;
      const [url, init] = call;
      expect(url).toBe(`https://analyticsdata.googleapis.com/v1beta/properties/${VALID_PROPERTY_ID}:batchRunReports`);
      expect(init.headers.Authorization).toBe('Bearer token-123');
      expect(init.signal).toBeDefined();

      const body = JSON.parse(init.body as string);
      expect(body.requests).toHaveLength(2);

      // (1) totals
      expect(body.requests[0]).toEqual({
        dateRanges: [
          { startDate: '30daysAgo', endDate: 'yesterday' },
          { startDate: '60daysAgo', endDate: '31daysAgo' },
        ],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
      });

      // (2) series
      expect(body.requests[1]).toEqual({
        dateRanges: [{ startDate: '30daysAgo', endDate: 'yesterday' }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
      });

      expect(res.configured).toBe(true);
      expect(res.note).toBe('Google Analytics figures can lag by up to a day. Each period ends on the last complete day.');
    });

    it('adds the enquiry report only when an event is set', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse([
          report({
            headers: { dimensions: ['dateRange'], metrics: ['activeUsers', 'screenPageViews'] },
            rows: [{ dimensions: ['date_range_0'], metrics: [10, 20] }],
          }),
          report({
            headers: { dimensions: ['date'], metrics: ['activeUsers', 'screenPageViews'] },
            rows: [],
          }),
          report({
            headers: { dimensions: ['dateRange'], metrics: ['eventCount'] },
            rows: [
              { dimensions: ['date_range_0'], metrics: [5] },
              { dimensions: ['date_range_1'], metrics: [2] },
            ],
          }),
        ])
      );

      const analytics = createAnalytics(
        {
          GA_PROPERTY_ID: VALID_PROPERTY_ID,
          GA_SERVICE_ACCOUNT_B64: VALID_SA_B64,
          GA_ENQUIRY_EVENT: 'contact_submit',
        },
        {
          fetch: fetchMock as any,
          accessToken: vi.fn().mockResolvedValue('token'),
          now: () => new Date('2026-10-23T12:00:00Z'),
        }
      );

      const res = await analytics.read(7);
      const call = fetchMock.mock.calls[0]!;
      const body = JSON.parse(call[1].body as string);

      expect(body.requests).toHaveLength(3);
      expect(body.requests[2]).toEqual({
        dateRanges: [
          { startDate: '7daysAgo', endDate: 'yesterday' },
          { startDate: '14daysAgo', endDate: '8daysAgo' },
        ],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            stringFilter: {
              matchType: 'EXACT',
              value: 'contact_submit',
            },
          },
        },
      });

      expect(res.metrics.map((m) => m.key)).toEqual(['visitors', 'views', 'enquiries']);
      expect(res.metrics[2]).toEqual({
        key: 'enquiries',
        label: 'Enquiries',
        count: 5,
        previous: 2,
      });
      // Series has only visitors and views
      expect(res.series.map((s) => s.key)).toEqual(['visitors', 'views']);
    });

    it('reads two-range rows by dateRange, not by order', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse([
          report({
            headers: { dimensions: ['dateRange'], metrics: ['activeUsers', 'screenPageViews'] },
            rows: [
              // date_range_1 (previous) comes first
              { dimensions: ['date_range_1'], metrics: [40, 70] },
              // date_range_0 (current) comes second
              { dimensions: ['date_range_0'], metrics: [120, 250] },
            ],
          }),
          report({
            headers: { dimensions: ['date'], metrics: ['activeUsers', 'screenPageViews'] },
            rows: [],
          }),
        ])
      );

      const analytics = createAnalytics(
        { GA_PROPERTY_ID: VALID_PROPERTY_ID, GA_SERVICE_ACCOUNT_B64: VALID_SA_B64 },
        {
          fetch: fetchMock as any,
          accessToken: vi.fn().mockResolvedValue('token'),
          now: () => new Date('2026-10-23T12:00:00Z'),
        }
      );

      const res = await analytics.read(30);
      expect(res.metrics).toEqual([
        { key: 'visitors', label: 'Visitors', count: 120, previous: 40 },
        { key: 'views', label: 'Page views', count: 250, previous: 70 },
      ]);
    });

    it('reads metrics by header name', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse([
          report({
            // Reversed metricHeaders
            headers: { dimensions: ['dateRange'], metrics: ['screenPageViews', 'activeUsers'] },
            rows: [
              { dimensions: ['date_range_0'], metrics: ['500', '150'] },
              { dimensions: ['date_range_1'], metrics: ['300', 'invalid_non_number'] },
            ],
          }),
          report({
            headers: { dimensions: ['date'], metrics: ['screenPageViews', 'activeUsers'] },
            rows: [],
          }),
        ])
      );

      const analytics = createAnalytics(
        { GA_PROPERTY_ID: VALID_PROPERTY_ID, GA_SERVICE_ACCOUNT_B64: VALID_SA_B64 },
        {
          fetch: fetchMock as any,
          accessToken: vi.fn().mockResolvedValue('token'),
          now: () => new Date('2026-10-23T12:00:00Z'),
        }
      );

      const res = await analytics.read(30);
      expect(res.metrics).toEqual([
        { key: 'visitors', label: 'Visitors', count: 150, previous: 0 },
        { key: 'views', label: 'Page views', count: 500, previous: 300 },
      ]);
    });

    it('treats a missing report row as zero', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse([
          report({
            headers: { dimensions: ['dateRange'], metrics: ['activeUsers', 'screenPageViews'] },
            rows: [], // no rows
          }),
          report({
            headers: { dimensions: ['date'], metrics: ['activeUsers', 'screenPageViews'] },
            rows: [],
          }),
          report({
            headers: { dimensions: ['dateRange'], metrics: ['eventCount'] },
            rows: [],
          }),
        ])
      );

      const analytics = createAnalytics(
        {
          GA_PROPERTY_ID: VALID_PROPERTY_ID,
          GA_SERVICE_ACCOUNT_B64: VALID_SA_B64,
          GA_ENQUIRY_EVENT: 'contact_submit',
        },
        {
          fetch: fetchMock as any,
          accessToken: vi.fn().mockResolvedValue('token'),
          now: () => new Date('2026-10-23T12:00:00Z'),
        }
      );

      const res = await analytics.read(7);
      expect(res.metrics).toEqual([
        { key: 'visitors', label: 'Visitors', count: 0, previous: 0 },
        { key: 'views', label: 'Page views', count: 0, previous: 0 },
        { key: 'enquiries', label: 'Enquiries', count: 0, previous: 0 },
      ]);
    });

    it('fills days Google omitted with 0 at the start, the middle and the end', async () => {
      // 7 days ending yesterday 2026-10-22: 2026-10-16 to 2026-10-22
      // Google provides only 2026-10-18 and 2026-10-19
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse([
          report({
            headers: { dimensions: ['dateRange'], metrics: ['activeUsers', 'screenPageViews'] },
            rows: [{ dimensions: ['date_range_0'], metrics: [15, 30] }],
          }),
          report({
            headers: { dimensions: ['date'], metrics: ['activeUsers', 'screenPageViews'] },
            rows: [
              { dimensions: ['20261018'], metrics: [6, 12] },
              { dimensions: ['20261019'], metrics: [9, 18] },
            ],
          }),
        ])
      );

      const analytics = createAnalytics(
        { GA_PROPERTY_ID: VALID_PROPERTY_ID, GA_SERVICE_ACCOUNT_B64: VALID_SA_B64 },
        {
          fetch: fetchMock as any,
          accessToken: vi.fn().mockResolvedValue('token'),
          now: () => new Date('2026-10-23T12:00:00Z'),
        }
      );

      const res = await analytics.read(7);
      expect(res.series[0]?.points).toHaveLength(7);
      expect(res.series[1]?.points).toHaveLength(7);

      expect(res.series[0]?.points).toEqual([
        { date: '2026-10-16', count: 0 },
        { date: '2026-10-17', count: 0 },
        { date: '2026-10-18', count: 6 },
        { date: '2026-10-19', count: 9 },
        { date: '2026-10-20', count: 0 },
        { date: '2026-10-21', count: 0 },
        { date: '2026-10-22', count: 0 },
      ]);
      expect(res.series[1]?.points).toEqual([
        { date: '2026-10-16', count: 0 },
        { date: '2026-10-17', count: 0 },
        { date: '2026-10-18', count: 12 },
        { date: '2026-10-19', count: 18 },
        { date: '2026-10-20', count: 0 },
        { date: '2026-10-21', count: 0 },
        { date: '2026-10-22', count: 0 },
      ]);
    });

    it("ends the window on yesterday in the property's own zone (Pacific/Auckland, now 2026-10-22T20:00Z gives 2026-10-23 there, so the window ends 2026-10-22)", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(
          [
            report({
              headers: { dimensions: ['dateRange'], metrics: ['activeUsers', 'screenPageViews'] },
              rows: [{ dimensions: ['date_range_0'], metrics: [1, 1] }],
              timeZone: 'Pacific/Auckland',
            }),
            report({
              headers: { dimensions: ['date'], metrics: ['activeUsers', 'screenPageViews'] },
              rows: [],
              timeZone: 'Pacific/Auckland',
            }),
          ],
          'Pacific/Auckland'
        )
      );

      const analytics = createAnalytics(
        { GA_PROPERTY_ID: VALID_PROPERTY_ID, GA_SERVICE_ACCOUNT_B64: VALID_SA_B64 },
        {
          fetch: fetchMock as any,
          accessToken: vi.fn().mockResolvedValue('token'),
          now: () => new Date('2026-10-22T20:00:00Z'),
        }
      );

      const res = await analytics.read(7);
      const points = res.series[0]?.points ?? [];
      expect(points).toHaveLength(7);
      expect(points[0]?.date).toBe('2026-10-16');
      expect(points[6]?.date).toBe('2026-10-22');
    });
  });

  describe('caching and concurrency', () => {
    it('one answer per key within 15 minutes, then asks again', async () => {
      let currentTime = new Date('2026-10-23T10:00:00.000Z');
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(
          mockResponse([
            report({
              headers: { dimensions: ['dateRange'], metrics: ['activeUsers', 'screenPageViews'] },
              rows: [{ dimensions: ['date_range_0'], metrics: [10, 20] }],
            }),
            report({
              headers: { dimensions: ['date'], metrics: ['activeUsers', 'screenPageViews'] },
              rows: [],
            }),
          ])
        )
      );

      const analytics = createAnalytics(
        { GA_PROPERTY_ID: VALID_PROPERTY_ID, GA_SERVICE_ACCOUNT_B64: VALID_SA_B64 },
        {
          fetch: fetchMock as any,
          accessToken: vi.fn().mockResolvedValue('token'),
          now: () => currentTime,
        }
      );

      // Call 1
      await analytics.read(7);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Call 2 at 14 minutes: reused from cache
      currentTime = new Date(currentTime.getTime() + 14 * 60 * 1000);
      await analytics.read(7);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Call 3 at 15 minutes + 1 ms: asks again
      currentTime = new Date(currentTime.getTime() + 1 * 60 * 1000 + 1);
      await analytics.read(7);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Different days is a different call
      await analytics.read(30);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('a failure is remembered for 60 seconds', async () => {
      let currentTime = new Date('2026-10-23T10:00:00.000Z');
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(new Response('Quota exceeded', { status: 429 }))
      );

      const analytics = createAnalytics(
        { GA_PROPERTY_ID: VALID_PROPERTY_ID, GA_SERVICE_ACCOUNT_B64: VALID_SA_B64 },
        {
          fetch: fetchMock as any,
          accessToken: vi.fn().mockResolvedValue('token'),
          now: () => currentTime,
        }
      );

      // First call fails
      await expect(analytics.read(7)).rejects.toMatchObject({
        message: 'Google Analytics quota exceeded',
        statusCode: 502,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call at 30 seconds fails without calling fetch again
      currentTime = new Date(currentTime.getTime() + 30 * 1000);
      await expect(analytics.read(7)).rejects.toMatchObject({
        message: 'Google Analytics quota exceeded',
        statusCode: 502,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Third call past 60 seconds calls fetch again
      currentTime = new Date(currentTime.getTime() + 31 * 1000);
      await expect(analytics.read(7)).rejects.toMatchObject({
        message: 'Google Analytics quota exceeded',
        statusCode: 502,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('concurrent calls share one request', async () => {
      const fetchMock = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  mockResponse([
                    report({
                      headers: { dimensions: ['dateRange'], metrics: ['activeUsers', 'screenPageViews'] },
                      rows: [{ dimensions: ['date_range_0'], metrics: [10, 20] }],
                    }),
                    report({
                      headers: { dimensions: ['date'], metrics: ['activeUsers', 'screenPageViews'] },
                      rows: [],
                    }),
                  ])
                ),
              10
            )
          )
      );

      const analytics = createAnalytics(
        { GA_PROPERTY_ID: VALID_PROPERTY_ID, GA_SERVICE_ACCOUNT_B64: VALID_SA_B64 },
        {
          fetch: fetchMock as any,
          accessToken: vi.fn().mockResolvedValue('token'),
          now: () => new Date('2026-10-23T10:00:00.000Z'),
        }
      );

      const [res1, res2] = await Promise.all([analytics.read(7), analytics.read(7)]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(res1).toEqual(res2);
    });
  });

  describe('configuration validation', () => {
    it.each([
      [
        'both variables unset',
        {},
        'Set GA_PROPERTY_ID and GA_SERVICE_ACCOUNT_B64 on the server and restart it.',
      ],
      [
        'GA_PROPERTY_ID not all digits',
        { GA_PROPERTY_ID: 'G-12345ABC', GA_SERVICE_ACCOUNT_B64: VALID_SA_B64 },
        'GA_PROPERTY_ID must be the numeric property id, not the G- measurement id.',
      ],
      [
        'GA_SERVICE_ACCOUNT_B64 not base64',
        { GA_PROPERTY_ID: '123456789', GA_SERVICE_ACCOUNT_B64: 'not-base64!@#$' },
        "GA_SERVICE_ACCOUNT_B64 isn't valid base64.",
      ],
      [
        'GA_SERVICE_ACCOUNT_B64 not JSON',
        {
          GA_PROPERTY_ID: '123456789',
          GA_SERVICE_ACCOUNT_B64: Buffer.from('hello plain text').toString('base64'),
        },
        "GA_SERVICE_ACCOUNT_B64 doesn't decode to JSON.",
      ],
      [
        'GA_SERVICE_ACCOUNT_B64 JSON without client_email and private_key',
        {
          GA_PROPERTY_ID: '123456789',
          GA_SERVICE_ACCOUNT_B64: Buffer.from(JSON.stringify({ client_email: 'a@b.com' })).toString('base64'),
        },
        'GA_SERVICE_ACCOUNT_B64 needs client_email and private_key.',
      ],
    ])('not configured case: %s', async (_name, envConfig, expectedNote) => {
      const fetchMock = vi.fn();
      const accessTokenMock = vi.fn();

      const analytics = createAnalytics(envConfig, {
        fetch: fetchMock as any,
        accessToken: accessTokenMock,
      });

      const res = await analytics.read(30);
      expect(res).toEqual({
        days: 30,
        configured: false,
        note: expectedNote,
        metrics: [],
        series: [],
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(accessTokenMock).not.toHaveBeenCalled();
    });
  });

  describe('error mapping', () => {
    it.each([
      [
        'Google 401',
        () => Promise.resolve(new Response('Unauthorized', { status: 401 })),
        'Google Analytics rejected the service account',
        undefined,
      ],
      [
        'Google 403',
        () => Promise.resolve(new Response('Forbidden', { status: 403 })),
        'Google Analytics rejected the service account',
        undefined,
      ],
      [
        'accessToken throwing',
        () => Promise.resolve(new Response('ok', { status: 200 })),
        'Google Analytics rejected the service account',
        new Error('Failed to get token'),
      ],
      [
        'Google 400',
        () => Promise.resolve(new Response('Bad Request', { status: 400 })),
        "Google Analytics doesn't know that property",
        undefined,
      ],
      [
        'Google 404',
        () => Promise.resolve(new Response('Not Found', { status: 404 })),
        "Google Analytics doesn't know that property",
        undefined,
      ],
      [
        'Google 429',
        () => Promise.resolve(new Response('Too Many Requests', { status: 429 })),
        'Google Analytics quota exceeded',
        undefined,
      ],
      [
        'fetch network error / reject',
        () => Promise.reject(new Error('network error')),
        "Google Analytics didn't answer",
        undefined,
      ],
      [
        'Google 500',
        () => Promise.resolve(new Response('Internal Error', { status: 500 })),
        'Google Analytics answered with an error',
        undefined,
      ],
      [
        'unparseable JSON body',
        () => Promise.resolve(new Response('not json', { status: 200 })),
        'Google Analytics answered with an error',
        undefined,
      ],
    ])('maps failure: %s', async (_name, fetchImpl, expectedMessage, accessTokenError) => {
      const accessTokenMock = accessTokenError
        ? vi.fn().mockRejectedValue(accessTokenError)
        : vi.fn().mockResolvedValue('token');

      const analytics = createAnalytics(
        { GA_PROPERTY_ID: VALID_PROPERTY_ID, GA_SERVICE_ACCOUNT_B64: VALID_SA_B64 },
        {
          fetch: vi.fn().mockImplementation(fetchImpl) as any,
          accessToken: accessTokenMock,
          now: () => new Date('2026-10-23T10:00:00.000Z'),
        }
      );

      await expect(analytics.read(7)).rejects.toThrow(HttpException);
      await expect(analytics.read(7)).rejects.toMatchObject({
        message: expectedMessage,
        statusCode: 502,
      });
    });

    it('no output ever contains the private key', async () => {
      const sensitiveKey = VALID_SA.private_key;

      // 1. accessToken throws an error whose message contains the key
      const leakyAccessToken = vi.fn().mockRejectedValue(new Error(`Failed with key: ${sensitiveKey}`));
      const analyticsWithLeakyToken = createAnalytics(
        { GA_PROPERTY_ID: VALID_PROPERTY_ID, GA_SERVICE_ACCOUNT_B64: VALID_SA_B64 },
        {
          fetch: vi.fn() as any,
          accessToken: leakyAccessToken,
          now: () => new Date('2026-10-23T10:00:00.000Z'),
        }
      );

      let caughtError: any;
      try {
        await analyticsWithLeakyToken.read(7);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(HttpException);
      expect(caughtError.message).toBe('Google Analytics rejected the service account');
      expect(caughtError.statusCode).toBe(502);
      expect(caughtError.message).not.toContain(sensitiveKey);
      expect(JSON.stringify(caughtError)).not.toContain(sensitiveKey);

      // 2. Google returns an error body that echoes the key
      const leakyFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: `echo: ${sensitiveKey}` }), { status: 500 })
      );
      const analyticsWithLeakyFetch = createAnalytics(
        { GA_PROPERTY_ID: VALID_PROPERTY_ID, GA_SERVICE_ACCOUNT_B64: VALID_SA_B64 },
        {
          fetch: leakyFetch as any,
          accessToken: vi.fn().mockResolvedValue('token'),
          now: () => new Date('2026-10-23T10:00:00.000Z'),
        }
      );

      let caughtError2: any;
      try {
        await analyticsWithLeakyFetch.read(7);
      } catch (err) {
        caughtError2 = err;
      }

      expect(caughtError2).toBeInstanceOf(HttpException);
      expect(caughtError2.message).toBe('Google Analytics answered with an error');
      expect(caughtError2.statusCode).toBe(502);
      expect(caughtError2.message).not.toContain(sensitiveKey);
      expect(JSON.stringify(caughtError2)).not.toContain(sensitiveKey);
    });
  });

  describe('readAnalytics singleton', () => {
    it('calls read using env from @/env', async () => {
      // With env unset, readAnalytics returns configured: false
      env.GA_PROPERTY_ID = undefined;
      env.GA_SERVICE_ACCOUNT_B64 = undefined;
      const res = await readAnalytics(7);
      expect(res.configured).toBe(false);
      expect(res.days).toBe(7);
    });
  });
});

import { JWT } from 'google-auth-library';
import { env } from '@/env';
import { HttpException } from '@/utils/exceptions';

export const ANALYTICS_DAYS = [7, 30, 90] as const;
export type AnalyticsDays = (typeof ANALYTICS_DAYS)[number];

export type MetricUnit = 'number' | 'percent' | 'duration';

export type AdminAnalyticsMetric = {
  key: string;
  label: string;
  count: number;
  previous: number;
  /** How the dashboard formats the value: counts, percents or seconds. */
  unit?: MetricUnit;
};

export type AdminAnalytics = {
  days: AnalyticsDays;
  configured: boolean;
  note: string | null;
  metrics: AdminAnalyticsMetric[];
  series: { key: string; label: string; points: { date: string; count: number }[] }[];
};

export type AnalyticsEnv = {
  GA_PROPERTY_ID?: string;
  GA_SERVICE_ACCOUNT_B64?: string;
  GA_ENQUIRY_EVENT?: string;
};

export type AnalyticsDeps = {
  fetch: typeof fetch;
  accessToken: (account: { client_email: string; private_key: string }) => Promise<string>;
  now: () => Date;
};

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

interface CacheSuccess {
  type: 'success';
  data: AdminAnalytics;
  expiresAt: number;
}

interface CacheFailure {
  type: 'failure';
  error: HttpException;
  expiresAt: number;
}

type CacheEntry = CacheSuccess | CacheFailure;

const NOTE_LAG =
  'Google Analytics figures can lag by up to a day. Each period ends on the last complete day.';

/** Shared JWT clients keyed by client_email so token caching in google-auth-library works. */
const jwtClients = new Map<string, JWT>();

/**
 * Returns an OAuth2 bearer access token for the given service account.
 * Reuses the same JWT client instance per client_email to preserve its token cache.
 */
async function defaultAccessToken(account: ServiceAccountKey): Promise<string> {
  let client = jwtClients.get(account.client_email);
  if (!client) {
    client = new JWT({
      email: account.client_email,
      key: account.private_key,
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });
    jwtClients.set(account.client_email, client);
  }
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse.token) {
    throw new Error('No access token returned');
  }
  return tokenResponse.token;
}

/** Validates that a string is non-empty, length multiple of 4, and contains valid base64 characters. */
function isBase64String(value: string): boolean {
  if (!value || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/**
 * Validates query parameters according to spec §6.7.
 * Only `days` is accepted, exactly one value, and must be 7, 30, or 90.
 * Any other parameter name causes `{ error: <name> }` for the first offending parameter.
 */
export function parseAnalyticsQuery(
  params: URLSearchParams
): { days: AnalyticsDays } | { error: string } {
  for (const [name] of params) {
    if (name !== 'days') {
      return { error: name };
    }
  }

  const daysValues = params.getAll('days');
  if (daysValues.length !== 1) {
    return { error: 'days' };
  }

  const parsed = Number(daysValues[0]);
  if (!ANALYTICS_DAYS.includes(parsed as AnalyticsDays)) {
    return { error: 'days' };
  }

  return { days: parsed as AnalyticsDays };
}

/**
 * Validates the credentials and property configuration from the environment.
 * When invalid or missing, returns an unconfigured AdminAnalytics result.
 */
function validateConfig(
  envConfig: AnalyticsEnv,
  days: AnalyticsDays
): { account: ServiceAccountKey; propertyId: string } | AdminAnalytics {
  const { GA_PROPERTY_ID: propertyId, GA_SERVICE_ACCOUNT_B64: saB64 } = envConfig;

  if (!propertyId && !saB64) {
    return {
      days,
      configured: false,
      note: 'Set GA_PROPERTY_ID and GA_SERVICE_ACCOUNT_B64 on the server and restart it.',
      metrics: [],
      series: [],
    };
  }

  if (!propertyId || !/^\d+$/.test(propertyId)) {
    return {
      days,
      configured: false,
      note: 'GA_PROPERTY_ID must be the numeric property id, not the G- measurement id.',
      metrics: [],
      series: [],
    };
  }

  if (!saB64 || !isBase64String(saB64)) {
    return {
      days,
      configured: false,
      note: "GA_SERVICE_ACCOUNT_B64 isn't valid base64.",
      metrics: [],
      series: [],
    };
  }

  let decodedText: string;
  try {
    decodedText = Buffer.from(saB64, 'base64').toString('utf8');
  } catch {
    return {
      days,
      configured: false,
      note: "GA_SERVICE_ACCOUNT_B64 isn't valid base64.",
      metrics: [],
      series: [],
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(decodedText);
  } catch {
    return {
      days,
      configured: false,
      note: "GA_SERVICE_ACCOUNT_B64 doesn't decode to JSON.",
      metrics: [],
      series: [],
    };
  }

  if (
    typeof parsedJson !== 'object' ||
    parsedJson === null ||
    typeof (parsedJson as Record<string, unknown>).client_email !== 'string' ||
    typeof (parsedJson as Record<string, unknown>).private_key !== 'string'
  ) {
    return {
      days,
      configured: false,
      note: 'GA_SERVICE_ACCOUNT_B64 needs client_email and private_key.',
      metrics: [],
      series: [],
    };
  }

  return {
    account: {
      client_email: (parsedJson as Record<string, unknown>).client_email as string,
      private_key: (parsedJson as Record<string, unknown>).private_key as string,
    },
    propertyId,
  };
}

/** Formats a Date in the given timeZone as YYYY-MM-DD. */
function dateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

/** Generates the list of YYYY-MM-DD date strings for the window ending yesterday without DST maths. */
function computeWindowDates(referenceDate: Date, timeZone: string, days: number): string[] {
  const todayStr = dateInTimeZone(referenceDate, timeZone);
  const parts = todayStr.split('-').map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const dates: string[] = [];

  for (let offset = days; offset >= 1; offset--) {
    const calendarDate = new Date(Date.UTC(year, month - 1, day - offset));
    dates.push(calendarDate.toISOString().slice(0, 10));
  }

  return dates;
}

/** Reads a metric value from a report by dateRange dimension and metric header name. */
function extractMetricValue(
  reportData: Record<string, unknown> | undefined,
  dateRangeVal: string,
  metricName: string
): number {
  if (!reportData) return 0;

  const rows = reportData.rows as Array<{
    dimensionValues?: Array<{ value: string }>;
    metricValues?: Array<{ value: string }>;
  }> | undefined;
  const dimensionHeaders = reportData.dimensionHeaders as Array<{ name: string }> | undefined;
  const metricHeaders = reportData.metricHeaders as Array<{ name: string }> | undefined;

  if (!rows || !metricHeaders) return 0;

  const metricIndex = metricHeaders.findIndex((h) => h.name === metricName);
  if (metricIndex === -1) return 0;

  const rangeDimIndex = dimensionHeaders?.findIndex((h) => h.name === 'dateRange') ?? -1;

  for (const row of rows) {
    if (rangeDimIndex !== -1) {
      const currentRange = row.dimensionValues?.[rangeDimIndex]?.value;
      if (currentRange !== dateRangeVal) continue;
    }

    const raw = row.metricValues?.[metricIndex]?.value;
    // Rates and durations come back as decimals ("0.68", "95.4"), so parseFloat, not parseInt.
    const parsed = parseFloat(raw ?? '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

/**
 * Creates an analytics reader with the provided environment variables and dependencies.
 * Maintains an in-memory cache and in-flight deduplication.
 */
export function createAnalytics(
  envConfig: AnalyticsEnv,
  deps?: Partial<AnalyticsDeps>
): { read(days: AnalyticsDays): Promise<AdminAnalytics> } {
  const fetchFn = deps?.fetch ?? fetch;
  const getAccessToken = deps?.accessToken ?? defaultAccessToken;
  const getNow = deps?.now ?? (() => new Date());

  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<AdminAnalytics>>();

  async function performRead(
    days: AnalyticsDays,
    account: ServiceAccountKey,
    propertyId: string
  ): Promise<AdminAnalytics> {
    let token: string;
    try {
      token = await getAccessToken(account);
    } catch {
      throw new HttpException('Google Analytics rejected the service account', 502);
    }

    const requests: Array<Record<string, unknown>> = [
      // (1) Totals: 2 date ranges, no dimensions
      {
        dateRanges: [
          { startDate: `${days}daysAgo`, endDate: 'yesterday' },
          { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` },
        ],
        metrics: [
          { name: 'activeUsers' },
          { name: 'screenPageViews' },
          { name: 'sessions' },
          { name: 'engagementRate' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
        ],
      },
      // (2) Series: current range only, dimension date, ordered by date ascending
      {
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
      },
      // (3) Clicks: both ranges, metric eventCount, exact event name filter
      {
        dateRanges: [
          { startDate: `${days}daysAgo`, endDate: 'yesterday' },
          { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` },
        ],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            stringFilter: {
              matchType: 'EXACT',
              value: 'click',
            },
          },
        },
      },
    ];

    if (envConfig.GA_ENQUIRY_EVENT) {
      // (4) Enquiries: both ranges, metric eventCount, exact event name filter
      requests.push({
        dateRanges: [
          { startDate: `${days}daysAgo`, endDate: 'yesterday' },
          { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` },
        ],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            stringFilter: {
              matchType: 'EXACT',
              value: envConfig.GA_ENQUIRY_EVENT,
            },
          },
        },
      });
    }

    let response: Response;
    try {
      response = await fetchFn(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requests }),
          signal: AbortSignal.timeout(10_000),
        }
      );
    } catch {
      throw new HttpException("Google Analytics didn't answer", 502);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new HttpException('Google Analytics rejected the service account', 502);
      }
      if (response.status === 400 || response.status === 404) {
        throw new HttpException("Google Analytics doesn't know that property", 502);
      }
      if (response.status === 429) {
        throw new HttpException('Google Analytics quota exceeded', 502);
      }
      throw new HttpException('Google Analytics answered with an error', 502);
    }

    let payload: {
      reports?: Array<Record<string, unknown>>;
      metadata?: { timeZone?: string };
    };
    try {
      payload = (await response.json()) as {
        reports?: Array<Record<string, unknown>>;
        metadata?: { timeZone?: string };
      };
    } catch {
      throw new HttpException('Google Analytics answered with an error', 502);
    }

    const firstReport = payload.reports?.[0];
    const timeZone =
      (firstReport?.metadata as { timeZone?: string } | undefined)?.timeZone ??
      payload.metadata?.timeZone ??
      'UTC';

    const windowDates = computeWindowDates(getNow(), timeZone, days);

    // Totals mapping
    /**
     * One metric as the dashboard reads it: both periods, in the unit it is written in.
     * GA4 returns rates as ratios (0.68) and durations in seconds (95.4).
     */
    const readMetric = (
      reportData: Record<string, unknown> | undefined,
      spec: { key: string; label: string; metric: string; unit: MetricUnit }
    ): AdminAnalyticsMetric => {
      const scale = spec.unit === 'percent' ? 100 : 1;
      const round = (value: number) =>
        spec.unit === 'percent' ? Math.round(value * 10) / 10 : Math.round(value);

      return {
        key: spec.key,
        label: spec.label,
        count: round(extractMetricValue(reportData, 'date_range_0', spec.metric) * scale),
        previous: round(extractMetricValue(reportData, 'date_range_1', spec.metric) * scale),
        unit: spec.unit,
      };
    };

    const metrics: AdminAnalyticsMetric[] = [
      readMetric(firstReport, {
        key: 'visitors',
        label: 'Visitors',
        metric: 'activeUsers',
        unit: 'number',
      }),
      readMetric(firstReport, {
        key: 'views',
        label: 'Page views',
        metric: 'screenPageViews',
        unit: 'number',
      }),
      readMetric(firstReport, {
        key: 'sessions',
        label: 'Sessions',
        metric: 'sessions',
        unit: 'number',
      }),
      readMetric(firstReport, {
        key: 'engagement',
        label: 'Engagement rate',
        metric: 'engagementRate',
        unit: 'percent',
      }),
      readMetric(firstReport, {
        key: 'bounce',
        label: 'Bounce rate',
        metric: 'bounceRate',
        unit: 'percent',
      }),
      readMetric(firstReport, {
        key: 'duration',
        label: 'Avg session duration',
        metric: 'averageSessionDuration',
        unit: 'duration',
      }),
      readMetric(payload.reports?.[2], {
        key: 'clicks',
        label: 'Clicks',
        metric: 'eventCount',
        unit: 'number',
      }),
    ];

    if (envConfig.GA_ENQUIRY_EVENT) {
      metrics.push(
        readMetric(payload.reports?.[3], {
          key: 'enquiries',
          label: 'Enquiries',
          metric: 'eventCount',
          unit: 'number',
        })
      );
    }

    // Series mapping
    const seriesReport = payload.reports?.[1];
    const seriesRows = seriesReport?.rows as Array<{
      dimensionValues?: Array<{ value: string }>;
      metricValues?: Array<{ value: string }>;
    }> | undefined;
    const seriesDimHeaders = seriesReport?.dimensionHeaders as Array<{ name: string }> | undefined;
    const seriesMetricHeaders = seriesReport?.metricHeaders as Array<{ name: string }> | undefined;

    const dateDimIndex = seriesDimHeaders?.findIndex((h) => h.name === 'date') ?? -1;
    const activeUsersIndex = seriesMetricHeaders?.findIndex((h) => h.name === 'activeUsers') ?? -1;
    const screenPageViewsIndex =
      seriesMetricHeaders?.findIndex((h) => h.name === 'screenPageViews') ?? -1;

    const visitorsByDate = new Map<string, number>();
    const viewsByDate = new Map<string, number>();

    if (seriesRows && dateDimIndex !== -1) {
      for (const row of seriesRows) {
        const rawDate = row.dimensionValues?.[dateDimIndex]?.value;
        if (!rawDate || rawDate.length !== 8) continue;
        const formattedDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;

        if (activeUsersIndex !== -1) {
          const val = parseInt(row.metricValues?.[activeUsersIndex]?.value ?? '', 10);
          visitorsByDate.set(formattedDate, Number.isFinite(val) ? val : 0);
        }
        if (screenPageViewsIndex !== -1) {
          const val = parseInt(row.metricValues?.[screenPageViewsIndex]?.value ?? '', 10);
          viewsByDate.set(formattedDate, Number.isFinite(val) ? val : 0);
        }
      }
    }

    const series: AdminAnalytics['series'] = [
      {
        key: 'visitors',
        label: 'Visitors',
        points: windowDates.map((date) => ({
          date,
          count: visitorsByDate.get(date) ?? 0,
        })),
      },
      {
        key: 'views',
        label: 'Page views',
        points: windowDates.map((date) => ({
          date,
          count: viewsByDate.get(date) ?? 0,
        })),
      },
    ];

    return {
      days,
      configured: true,
      note: NOTE_LAG,
      metrics,
      series,
    };
  }

  return {
    async read(days: AnalyticsDays): Promise<AdminAnalytics> {
      const configOrResult = validateConfig(envConfig, days);
      if ('configured' in configOrResult) {
        return configOrResult;
      }

      const { account, propertyId } = configOrResult;
      const cacheKey = `${propertyId}|${days}|${envConfig.GA_ENQUIRY_EVENT ?? ''}`;
      const nowMs = getNow().getTime();

      const cached = cache.get(cacheKey);
      if (cached) {
        if (cached.expiresAt > nowMs) {
          if (cached.type === 'success') {
            return cached.data;
          }
          throw cached.error;
        }
        cache.delete(cacheKey);
      }

      const running = inFlight.get(cacheKey);
      if (running) {
        return running;
      }

      const requestPromise = (async () => {
        try {
          const result = await performRead(days, account, propertyId);
          cache.set(cacheKey, {
            type: 'success',
            data: result,
            expiresAt: getNow().getTime() + 15 * 60 * 1000,
          });
          return result;
        } catch (error) {
          const mapped =
            error instanceof HttpException
              ? error
              : new HttpException('Google Analytics answered with an error', 502);
          cache.set(cacheKey, {
            type: 'failure',
            error: mapped,
            expiresAt: getNow().getTime() + 60 * 1000,
          });
          throw mapped;
        } finally {
          inFlight.delete(cacheKey);
        }
      })();

      inFlight.set(cacheKey, requestPromise);
      return requestPromise;
    },
  };
}

/** Global analytics reader instance created once using env from @/env. */
let defaultAnalytics: { read(days: AnalyticsDays): Promise<AdminAnalytics> } | undefined;

/**
 * Reads Google Analytics using the environment variables from `@/env`.
 * Created once and shared across requests.
 */
export function readAnalytics(days: AnalyticsDays): Promise<AdminAnalytics> {
  defaultAnalytics ??= createAnalytics(env as unknown as AnalyticsEnv);
  return defaultAnalytics.read(days);
}

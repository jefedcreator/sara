import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { withMiddleware } from "@/backend/middleware";
import type { AuthRequest } from "@/backend/middleware/types";
import type { ApiResponse } from "types";
import { HttpException } from "@/utils/exceptions";
import { analyticsHandler } from "../handlers";
import type * as AnalyticsKit from "../kit/analytics";
import {
  readAnalytics,
  type AdminAnalytics,
  type AnalyticsDays,
} from "../kit/analytics";
import {
  adminAnalyticsQueryMiddleware,
  adminAuthMiddleware,
} from "../middleware";

const env = vi.hoisted(
  (): { ADMIN_API_TOKEN?: string; ADMIN_ORIGIN?: string } => ({
    ADMIN_API_TOKEN: "k3J9xQ2mV8pL4wR7tY1uZ6aB0cD5eF9gH2iJ8kL3mN4=",
    ADMIN_ORIGIN: "https://admin.interacti.test",
  }),
);

vi.mock("@/env", () => ({ env }));

vi.mock("../kit/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyticsKit>();
  return {
    ...actual,
    readAnalytics: vi.fn(),
  };
});

const mockAnalyticsData: AdminAnalytics = {
  days: 30,
  configured: true,
  note: "Google Analytics figures can lag by up to a day. Each period ends on the last complete day.",
  metrics: [
    { key: "visitors", label: "Visitors", count: 120, previous: 100 },
    { key: "views", label: "Page views", count: 450, previous: 380 },
  ],
  series: [
    {
      key: "visitors",
      label: "Visitors",
      points: [{ date: "2026-10-25", count: 10 }],
    },
    {
      key: "views",
      label: "Page views",
      points: [{ date: "2026-10-25", count: 35 }],
    },
  ],
};

beforeEach(() => {
  env.ADMIN_API_TOKEN = "k3J9xQ2mV8pL4wR7tY1uZ6aB0cD5eF9gH2iJ8kL3mN4=";
  env.ADMIN_ORIGIN = "https://admin.interacti.test";
  vi.clearAllMocks();
});

describe("adminAnalyticsQueryMiddleware", () => {
  it("middleware sets request.query for days=30", async () => {
    const request = new NextRequest(
      "https://sara.test/api/admin/analytics?days=30",
    ) as AuthRequest<unknown, { days: AnalyticsDays }>;
    const result = await adminAnalyticsQueryMiddleware(request);
    expect(result.next).toBe(true);
    expect(request.query).toEqual({ days: 30 });
  });

  it("…answers 422 'Invalid query parameter: days' for days=5", async () => {
    const request = new NextRequest(
      "https://sara.test/api/admin/analytics?days=5",
    ) as AuthRequest<unknown, { days: AnalyticsDays }>;
    const result = await adminAnalyticsQueryMiddleware(request);
    expect(result.next).toBe(false);
    if (result.next) return;
    expect(result.statusCode).toBe(422);
    expect(result.message).toBe("Invalid query parameter: days");
  });

  it("…names x for days=7&x=1", async () => {
    const request = new NextRequest(
      "https://sara.test/api/admin/analytics?days=7&x=1",
    ) as AuthRequest<unknown, { days: AnalyticsDays }>;
    const result = await adminAnalyticsQueryMiddleware(request);
    expect(result.next).toBe(false);
    if (result.next) return;
    expect(result.statusCode).toBe(422);
    expect(result.message).toBe("Invalid query parameter: x");
  });
});

describe("analyticsHandler", () => {
  it("handler wraps the answer in Sara's envelope", async () => {
    vi.mocked(readAnalytics).mockResolvedValueOnce(mockAnalyticsData);
    const request = {
      query: { days: 30 },
    } as AuthRequest<unknown, { days: AnalyticsDays }>;

    const response = await analyticsHandler(request);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ApiResponse<AdminAnalytics>;
    expect(body).toEqual({
      status: 200,
      message: "Analytics retrieved",
      data: mockAnalyticsData,
    });
    expect(readAnalytics).toHaveBeenCalledWith(30);
  });

  it("answers a Google failure with Sara's { message } envelope", async () => {
    vi.mocked(readAnalytics).mockRejectedValueOnce(
      new HttpException("Google Analytics quota exceeded", 502),
    );
    const route = withMiddleware<unknown, { days: AnalyticsDays }>(
      analyticsHandler,
      [],
    );

    const response = await route(
      new Request("https://sara.test/api/admin/analytics?days=30"),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      message: "Google Analytics quota exceeded",
    });
  });
});

describe("order of refusal", () => {
  it("a bad token is 401 and admin-off is 404 before days is looked at", async () => {
    const runPipeline = async (
      request: AuthRequest<unknown, { days: AnalyticsDays }>,
    ) => {
      const auth = await adminAuthMiddleware(request);
      if (!auth.next) return auth;
      return adminAnalyticsQueryMiddleware(request);
    };

    env.ADMIN_API_TOKEN = "k3J9xQ2mV8pL4wR7tY1uZ6aB0cD5eF9gH2iJ8kL3mN4=";
    const badTokenRequest = new NextRequest(
      "https://sara.test/api/admin/analytics?days=bogus",
      { headers: { authorization: "Bearer wrong-token" } },
    ) as AuthRequest<unknown, { days: AnalyticsDays }>;
    const badToken = await runPipeline(badTokenRequest);
    expect(badToken.next).toBe(false);
    if (badToken.next) return;
    expect(badToken.statusCode).toBe(401);
    expect(badToken.message).toBe("Unauthorized");

    env.ADMIN_API_TOKEN = undefined;
    const adminOffRequest = new NextRequest(
      "https://sara.test/api/admin/analytics?days=bogus",
      {
        headers: {
          authorization: "Bearer k3J9xQ2mV8pL4wR7tY1uZ6aB0cD5eF9gH2iJ8kL3mN4=",
        },
      },
    ) as AuthRequest<unknown, { days: AnalyticsDays }>;
    const adminOff = await runPipeline(adminOffRequest);
    expect(adminOff.next).toBe(false);
    if (adminOff.next) return;
    expect(adminOff.statusCode).toBe(404);
    expect(adminOff.message).toBe("Not Found");
  });
});

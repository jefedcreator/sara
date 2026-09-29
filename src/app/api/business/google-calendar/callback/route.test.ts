import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => ({
  db: {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    business: { update: vi.fn() },
  },
}));

vi.mock("@/backend/services/googleCalendar", () => ({
  googleCalendarService: { exchangeCodeForTokens: vi.fn() },
}));

import { googleCalendarService } from "@/backend/services/googleCalendar";
import { db } from "@/server/db";
import { GET } from "./route";

const mockedDb = db as any;
const mockedCalendar = googleCalendarService as any;

const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
});

describe("GET /api/business/google-calendar/callback", () => {
  it("exchanges the code and persists tokens onto the business", async () => {
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    mockedCalendar.exchangeCodeForTokens.mockResolvedValue({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt,
    });

    const request = createMockRequest({
      url: "http://localhost:3000/api/business/google-calendar/callback?code=auth-code",
      cookies: authenticatedCookies(),
    });
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ connected: true });
    expect(mockedCalendar.exchangeCodeForTokens).toHaveBeenCalledWith(
      "auth-code",
    );
    expect(mockedDb.business.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BUSINESS.id },
        data: expect.objectContaining({
          googleCalendarAccessToken: "access-1",
          googleCalendarRefreshToken: "refresh-1",
          googleCalendarTokenExpiry: expiresAt,
        }),
      }),
    );
  });

  it("returns an error when the code is missing", async () => {
    const request = createMockRequest({
      url: "http://localhost:3000/api/business/google-calendar/callback",
      cookies: authenticatedCookies(),
    });
    const response = await GET(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    expect(mockedCalendar.exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("surfaces an error (rather than silently no-op) when token exchange fails", async () => {
    mockedCalendar.exchangeCodeForTokens.mockRejectedValue(
      new Error("invalid_grant"),
    );

    const request = createMockRequest({
      url: "http://localhost:3000/api/business/google-calendar/callback?code=bad-code",
      cookies: authenticatedCookies(),
    });
    const response = await GET(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(500);
    expect(mockedDb.business.update).not.toHaveBeenCalled();
  });

  it("sends a browser back to settings when connected", async () => {
    mockedCalendar.exchangeCodeForTokens.mockResolvedValue({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });

    const request = createMockRequest({
      url: "http://localhost:3000/api/business/google-calendar/callback?code=auth-code",
      cookies: authenticatedCookies(),
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    const response = await GET(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      "/settings?calendar=connected",
    );
  });

  it("sends a browser back to settings with the failure", async () => {
    mockedCalendar.exchangeCodeForTokens.mockRejectedValue(new Error("boom"));

    const request = createMockRequest({
      url: "http://localhost:3000/api/business/google-calendar/callback?code=auth-code",
      cookies: authenticatedCookies(),
      headers: { accept: "text/html" },
    });
    const response = await GET(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/settings?calendar=failed");
    expect(mockedDb.business.update).not.toHaveBeenCalled();
  });
});

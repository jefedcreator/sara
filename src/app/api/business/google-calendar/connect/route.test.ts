import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => ({
  db: { session: { findUnique: vi.fn(), delete: vi.fn() } },
}));

vi.mock("@/backend/services/googleCalendar", () => ({
  googleCalendarService: {
    getAuthorizationUrl: vi
      .fn()
      .mockReturnValue(
        "https://accounts.google.com/o/oauth2/v2/auth?scope=calendar.events+calendar.freebusy",
      ),
  },
}));

import { db } from "@/server/db";
import { GET } from "./route";

const mockedDb = db as any;

const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
});

describe("GET /api/business/google-calendar/connect", () => {
  it("returns an authorization URL with the expected scopes", async () => {
    const request = createMockRequest({ cookies: authenticatedCookies() });
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.authorizationUrl).toContain("calendar.events");
    expect(body.data.authorizationUrl).toContain("calendar.freebusy");
  });

  it("redirects when ?redirect=true", async () => {
    const request = createMockRequest({
      url: "http://localhost:3000/api/business/google-calendar/connect?redirect=true",
      cookies: authenticatedCookies(),
    });
    const response = await GET(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(307);
  });
});

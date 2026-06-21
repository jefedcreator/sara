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
  googleCalendarService: { revoke: vi.fn().mockResolvedValue(undefined) },
}));

import { googleCalendarService } from "@/backend/services/googleCalendar";
import { db } from "@/server/db";
import { DELETE } from "./route";

const mockedDb = db as any;
const mockedCalendar = googleCalendarService as any;

const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/business/google-calendar", () => {
  it("revokes the token and clears the stored fields when connected", async () => {
    const business = {
      id: "biz_1",
      ownerId: "user_1",
      googleCalendarRefreshToken: "refresh-1",
    };
    mockAuthenticatedSession(mockedDb, { user: USER, business });

    const request = createMockRequest({
      method: "DELETE",
      cookies: authenticatedCookies(),
    });
    const response = await DELETE(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ connected: false });
    expect(mockedCalendar.revoke).toHaveBeenCalledWith("refresh-1");
    expect(mockedDb.business.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: business.id },
        data: expect.objectContaining({
          googleCalendarAccessToken: null,
          googleCalendarRefreshToken: null,
        }),
      }),
    );
  });

  it("clears fields even when there was never a refresh token (already disconnected)", async () => {
    const business = {
      id: "biz_1",
      ownerId: "user_1",
      googleCalendarRefreshToken: null,
    };
    mockAuthenticatedSession(mockedDb, { user: USER, business });

    const request = createMockRequest({
      method: "DELETE",
      cookies: authenticatedCookies(),
    });
    const response = await DELETE(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    expect(mockedCalendar.revoke).not.toHaveBeenCalled();
    expect(mockedDb.business.update).toHaveBeenCalled();
  });
});

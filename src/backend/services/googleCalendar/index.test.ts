import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => ({
  default: { post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/server/db", () => ({
  db: { business: { update: vi.fn() } },
}));

import axios from "axios";
import { db } from "@/server/db";
import { googleCalendarService } from "./index";

const mockedAxios = axios as any;
const mockedDb = db as any;

const NOT_CONNECTED = {
  id: "biz_1",
  googleCalendarId: null,
  googleCalendarAccessToken: null,
  googleCalendarRefreshToken: null,
  googleCalendarTokenExpiry: null,
};

const CONNECTED_VALID_TOKEN = {
  id: "biz_1",
  googleCalendarId: null,
  googleCalendarAccessToken: "valid-access-token",
  googleCalendarRefreshToken: "refresh-token",
  googleCalendarTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
};

const CONNECTED_EXPIRED_TOKEN = {
  id: "biz_1",
  googleCalendarId: "custom-calendar-id",
  googleCalendarAccessToken: "stale-access-token",
  googleCalendarRefreshToken: "refresh-token",
  googleCalendarTokenExpiry: new Date(Date.now() - 1000),
};

const BOOKING = {
  startTime: new Date("2026-06-22T09:00:00.000Z"),
  endTime: new Date("2026-06-22T10:00:00.000Z"),
  clientName: "Jane Doe",
  notes: "First visit",
};

const SERVICE = { name: "Haircut" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAuthorizationUrl", () => {
  it("includes the calendar.events and calendar.freebusy scopes and prompt=consent", () => {
    const url = new URL(googleCalendarService.getAuthorizationUrl("state123"));

    expect(url.searchParams.get("scope")).toContain("calendar.events");
    expect(url.searchParams.get("scope")).toContain("calendar.freebusy");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("state123");
  });
});

describe("not-connected short-circuit (no HTTP call made)", () => {
  it("createEvent returns null without calling axios", async () => {
    const result = await googleCalendarService.createEvent(
      NOT_CONNECTED,
      BOOKING,
      SERVICE,
    );

    expect(result).toBeNull();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("updateEvent resolves without calling axios", async () => {
    await googleCalendarService.updateEvent(
      NOT_CONNECTED,
      { ...BOOKING, googleEventId: "evt_1" },
      SERVICE,
    );

    expect(mockedAxios.patch).not.toHaveBeenCalled();
  });

  it("deleteEvent resolves without calling axios", async () => {
    await googleCalendarService.deleteEvent(NOT_CONNECTED, "evt_1");

    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it("getBusyIntervals returns [] without calling axios", async () => {
    const result = await googleCalendarService.getBusyIntervals(
      NOT_CONNECTED,
      "2026-06-22",
    );

    expect(result).toEqual([]);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

describe("createEvent when connected", () => {
  it("sends the correct payload to the primary calendar by default", async () => {
    mockedAxios.post.mockResolvedValue({ data: { id: "evt_new" } });

    const result = await googleCalendarService.createEvent(
      CONNECTED_VALID_TOKEN,
      BOOKING,
      SERVICE,
    );

    expect(result).toEqual({ googleEventId: "evt_new" });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining("/calendars/primary/events"),
      expect.objectContaining({
        summary: "Haircut — Jane Doe",
        start: { dateTime: BOOKING.startTime.toISOString() },
        end: { dateTime: BOOKING.endTime.toISOString() },
      }),
      expect.objectContaining({
        headers: { Authorization: "Bearer valid-access-token" },
      }),
    );
  });

  it("uses the business's custom calendarId when set", async () => {
    // CONNECTED_EXPIRED_TOKEN forces a refresh call before the event create,
    // so the create call is always the *last* axios.post call.
    mockedAxios.post
      .mockResolvedValueOnce({
        data: { access_token: "fresh-token", expires_in: 3600 },
      })
      .mockResolvedValueOnce({ data: { id: "evt_new" } });

    await googleCalendarService.createEvent(
      CONNECTED_EXPIRED_TOKEN,
      BOOKING,
      SERVICE,
    );

    const calls = mockedAxios.post.mock.calls;
    const lastCallUrl = calls[calls.length - 1][0] as string;
    expect(lastCallUrl).toContain("/calendars/custom-calendar-id/events");
  });

  it("returns null and does not throw when the Google API call fails", async () => {
    mockedAxios.post.mockRejectedValue(new Error("Google API down"));

    const result = await googleCalendarService.createEvent(
      CONNECTED_VALID_TOKEN,
      BOOKING,
      SERVICE,
    );

    expect(result).toBeNull();
  });
});

describe("ensureFreshAccessToken (via createEvent)", () => {
  it("does not refresh when the stored token is still valid", async () => {
    mockedAxios.post.mockResolvedValue({ data: { id: "evt_new" } });

    await googleCalendarService.createEvent(
      CONNECTED_VALID_TOKEN,
      BOOKING,
      SERVICE,
    );

    expect(mockedAxios.post).toHaveBeenCalledTimes(1); // only the create call
    expect(mockedDb.business.update).not.toHaveBeenCalled();
  });

  it("refreshes and persists a new token when expired", async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: { access_token: "fresh-token", expires_in: 3600 },
      })
      .mockResolvedValueOnce({ data: { id: "evt_new" } });

    await googleCalendarService.createEvent(
      CONNECTED_EXPIRED_TOKEN,
      BOOKING,
      SERVICE,
    );

    expect(mockedDb.business.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CONNECTED_EXPIRED_TOKEN.id },
        data: expect.objectContaining({
          googleCalendarAccessToken: "fresh-token",
        }),
      }),
    );
  });

  it("returns null (does not throw) when the refresh call fails", async () => {
    mockedAxios.post.mockRejectedValue(new Error("refresh failed"));

    const result = await googleCalendarService.createEvent(
      CONNECTED_EXPIRED_TOKEN,
      BOOKING,
      SERVICE,
    );

    expect(result).toBeNull();
    expect(mockedDb.business.update).not.toHaveBeenCalled();
  });
});

describe("exchangeCodeForTokens", () => {
  it("returns the access/refresh tokens and an expiry date", async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      },
    });

    const tokens = await googleCalendarService.exchangeCodeForTokens("auth-code");

    expect(tokens.accessToken).toBe("new-access");
    expect(tokens.refreshToken).toBe("new-refresh");
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("throws when Google doesn't return a refresh token", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { access_token: "new-access", expires_in: 3600 },
    });

    await expect(
      googleCalendarService.exchangeCodeForTokens("auth-code"),
    ).rejects.toThrow();
  });
});

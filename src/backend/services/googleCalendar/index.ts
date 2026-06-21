import { env } from "@/env";
import { db } from "@/server/db";
import { type Booking, type Business, type Service } from "@prisma/client";
import axios from "axios";

export type CalendarBusinessFields = Pick<
  Business,
  | "id"
  | "googleCalendarId"
  | "googleCalendarAccessToken"
  | "googleCalendarRefreshToken"
  | "googleCalendarTokenExpiry"
>;

type CalendarBookingFields = Pick<
  Booking,
  "startTime" | "endTime" | "clientName" | "notes"
>;

type CalendarServiceFields = Pick<Service, "name">;

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

type GoogleCalendarEvent = {
  id: string;
  summary?: string;
};

type GoogleFreeBusyResponse = {
  calendars: Record<string, { busy: { start: string; end: string }[] }>;
};

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API_BASE_URL = "https://www.googleapis.com/calendar/v3";
const SCOPE =
  "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy";

class GoogleCalendarService {
  private getRedirectUri(): string {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      "http://localhost:3000";
    return `${baseUrl}/api/business/google-calendar/callback`;
  }

  /**
   * `prompt=consent` is deliberate — Google only reliably returns a
   * refresh_token on first consent or when re-consent is forced. Without
   * it, a reconnect after a disconnect could silently fail to obtain a
   * usable refresh token.
   */
  getAuthorizationUrl(state: string): string {
    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", env.AUTH_GOOGLE_ID ?? "");
    url.searchParams.set("redirect_uri", this.getRedirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCodeForTokens(
    code: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const response = await axios.post<GoogleTokenResponse>(
      TOKEN_URL,
      new URLSearchParams({
        code,
        client_id: env.AUTH_GOOGLE_ID ?? "",
        client_secret: env.AUTH_GOOGLE_SECRET ?? "",
        redirect_uri: this.getRedirectUri(),
        grant_type: "authorization_code",
      }),
    );

    if (!response.data.refresh_token) {
      throw new Error(
        "Google did not return a refresh token. Reconnect with re-consent.",
      );
    }

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresAt: new Date(Date.now() + response.data.expires_in * 1000),
    };
  }

  /**
   * Returns a usable access token, refreshing it first if expired.
   * Returns `null` if the business has never connected Calendar, or if the
   * refresh itself fails — callers treat `null` as "not connected" and
   * skip the Google API call entirely, without throwing.
   */
  private async ensureFreshAccessToken(
    business: CalendarBusinessFields,
  ): Promise<string | null> {
    if (!business.googleCalendarRefreshToken) {
      return null;
    }

    const stillValid =
      business.googleCalendarAccessToken &&
      business.googleCalendarTokenExpiry &&
      business.googleCalendarTokenExpiry.getTime() - Date.now() > 60_000;

    if (stillValid) {
      return business.googleCalendarAccessToken;
    }

    try {
      const response = await axios.post<GoogleTokenResponse>(
        TOKEN_URL,
        new URLSearchParams({
          refresh_token: business.googleCalendarRefreshToken,
          client_id: env.AUTH_GOOGLE_ID ?? "",
          client_secret: env.AUTH_GOOGLE_SECRET ?? "",
          grant_type: "refresh_token",
        }),
      );

      const expiresAt = new Date(Date.now() + response.data.expires_in * 1000);

      await db.business.update({
        where: { id: business.id },
        data: {
          googleCalendarAccessToken: response.data.access_token,
          googleCalendarTokenExpiry: expiresAt,
        },
      });

      return response.data.access_token;
    } catch (error) {
      console.warn("[GoogleCalendar] Token refresh failed:", error);
      return null;
    }
  }

  private eventPayload(
    booking: CalendarBookingFields,
    service: CalendarServiceFields,
  ) {
    return {
      summary: `${service.name} — ${booking.clientName}`,
      description: booking.notes ?? undefined,
      start: { dateTime: booking.startTime.toISOString() },
      end: { dateTime: booking.endTime.toISOString() },
    };
  }

  async createEvent(
    business: CalendarBusinessFields,
    booking: CalendarBookingFields,
    service: CalendarServiceFields,
  ): Promise<{ googleEventId: string } | null> {
    const accessToken = await this.ensureFreshAccessToken(business);
    if (!accessToken) return null;

    try {
      const calendarId = business.googleCalendarId ?? "primary";
      const response = await axios.post<GoogleCalendarEvent>(
        `${API_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`,
        this.eventPayload(booking, service),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return { googleEventId: response.data.id };
    } catch (error) {
      console.warn("[GoogleCalendar] createEvent failed:", error);
      return null;
    }
  }

  async updateEvent(
    business: CalendarBusinessFields,
    booking: CalendarBookingFields & { googleEventId: string | null },
    service: CalendarServiceFields,
  ): Promise<void> {
    if (!booking.googleEventId) return;

    const accessToken = await this.ensureFreshAccessToken(business);
    if (!accessToken) return;

    try {
      const calendarId = business.googleCalendarId ?? "primary";
      await axios.patch(
        `${API_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(booking.googleEventId)}`,
        this.eventPayload(booking, service),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
    } catch (error) {
      console.warn("[GoogleCalendar] updateEvent failed:", error);
    }
  }

  async deleteEvent(
    business: CalendarBusinessFields,
    googleEventId: string,
  ): Promise<void> {
    const accessToken = await this.ensureFreshAccessToken(business);
    if (!accessToken) return;

    try {
      const calendarId = business.googleCalendarId ?? "primary";
      await axios.delete(
        `${API_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
    } catch (error) {
      console.warn("[GoogleCalendar] deleteEvent failed:", error);
    }
  }

  /**
   * Returns busy intervals on the connected calendar for the given date.
   * Returns `[]` if not connected or on any error — never throws.
   */
  async getBusyIntervals(
    business: CalendarBusinessFields,
    date: string,
  ): Promise<{ start: Date; end: Date }[]> {
    const accessToken = await this.ensureFreshAccessToken(business);
    if (!accessToken) return [];

    try {
      const calendarId = business.googleCalendarId ?? "primary";
      const timeMin = `${date}T00:00:00.000Z`;
      const timeMax = `${date}T23:59:59.999Z`;

      const response = await axios.post<GoogleFreeBusyResponse>(
        `${API_BASE_URL}/freeBusy`,
        {
          timeMin,
          timeMax,
          items: [{ id: calendarId }],
        },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const busy = response.data.calendars[calendarId]?.busy ?? [];
      return busy.map((interval) => ({
        start: new Date(interval.start),
        end: new Date(interval.end),
      }));
    } catch (error) {
      console.warn("[GoogleCalendar] getBusyIntervals failed:", error);
      return [];
    }
  }

  /** Best-effort token revocation, called by the disconnect route. */
  async revoke(refreshToken: string): Promise<void> {
    try {
      await axios.post(
        REVOKE_URL,
        new URLSearchParams({ token: refreshToken }),
      );
    } catch (error) {
      console.warn("[GoogleCalendar] revoke failed:", error);
    }
  }
}

export const googleCalendarService = new GoogleCalendarService();

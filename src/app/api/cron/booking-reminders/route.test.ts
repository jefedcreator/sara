import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest } from "@/backend/test-utils/mock-request";

const { mockedEnv } = vi.hoisted(() => ({
  mockedEnv: { CRON_SECRET: "test-secret" as string | undefined },
}));

vi.mock("@/env", () => ({ env: mockedEnv }));

vi.mock("@/server/db", () => ({
  db: {
    booking: { findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/backend/services/email", () => ({
  emailService: {
    sendBookingReminderEmail: vi.fn().mockResolvedValue({ success: true }),
  },
}));

import { emailService } from "@/backend/services/email";
import { db } from "@/server/db";
import { GET } from "./route";

const mockedDb = db as any;
const mockedEmail = emailService as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockedEnv.CRON_SECRET = "test-secret";
  mockedDb.booking.findMany.mockResolvedValue([]);
});

function requestWithAuth(secret?: string) {
  return createMockRequest({
    url: "http://localhost:3000/api/cron/booking-reminders",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe("GET /api/cron/booking-reminders", () => {
  it("rejects a missing Authorization header", async () => {
    const response = await GET(requestWithAuth(), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(401);
    expect(mockedDb.booking.findMany).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", async () => {
    const response = await GET(requestWithAuth("wrong-secret"), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(401);
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    mockedEnv.CRON_SECRET = undefined;

    const response = await GET(requestWithAuth("anything"), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(500);
  });

  it("queries CONFIRMED bookings within the next 24h with no reminder sent yet", async () => {
    const response = await GET(requestWithAuth("test-secret"), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(200);
    expect(mockedDb.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "CONFIRMED",
          reminderSentAt: null,
        }),
      }),
    );
  });

  it("sends a reminder and marks reminderSentAt for each due booking", async () => {
    const booking = {
      id: "bkg_1",
      publicId: "Pq8sN1xV0kL3mA6t",
      clientEmail: "jane@example.com",
      startTime: new Date(),
      business: { name: "Acme Salon" },
      service: { name: "Haircut" },
    };
    mockedDb.booking.findMany.mockResolvedValue([booking]);

    const response = await GET(requestWithAuth("test-secret"), {
      params: Promise.resolve({}),
    });
    const body = await response.json();

    expect(body.data).toEqual({ checked: 1, sent: 1, failed: 0 });
    expect(mockedEmail.sendBookingReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: booking.clientEmail,
        bookingUrl: expect.stringMatching(/\/bookings\/Pq8sN1xV0kL3mA6t$/),
      }),
    );
    expect(mockedDb.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: booking.id },
        data: { reminderSentAt: expect.any(Date) },
      }),
    );
  });

  it("still marks reminderSentAt when the email send fails, and reports it as failed", async () => {
    mockedEmail.sendBookingReminderEmail.mockResolvedValue({
      success: false,
      error: "Resend down",
    });
    const booking = {
      id: "bkg_1",
      clientEmail: "jane@example.com",
      startTime: new Date(),
      business: { name: "Acme Salon" },
      service: { name: "Haircut" },
    };
    mockedDb.booking.findMany.mockResolvedValue([booking]);

    const response = await GET(requestWithAuth("test-secret"), {
      params: Promise.resolve({}),
    });
    const body = await response.json();

    expect(body.data).toEqual({ checked: 1, sent: 0, failed: 1 });
    expect(mockedDb.booking.update).toHaveBeenCalled();
  });

  it("skips the email send for a booking with no clientEmail but still marks it processed", async () => {
    const booking = {
      id: "bkg_1",
      clientEmail: null,
      startTime: new Date(),
      business: { name: "Acme Salon" },
      service: { name: "Haircut" },
    };
    mockedDb.booking.findMany.mockResolvedValue([booking]);

    await GET(requestWithAuth("test-secret"), { params: Promise.resolve({}) });

    expect(mockedEmail.sendBookingReminderEmail).not.toHaveBeenCalled();
    expect(mockedDb.booking.update).toHaveBeenCalled();
  });
});

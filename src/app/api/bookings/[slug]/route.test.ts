import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => {
  const db: any = {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    booking: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});

vi.mock("@/backend/services/email", () => ({
  emailService: {
    sendBookingCancellationEmail: vi.fn().mockResolvedValue({ success: true }),
    sendBookingRescheduledEmail: vi.fn().mockResolvedValue({ success: true }),
  },
}));

import { emailService } from "@/backend/services/email";
import { db } from "@/server/db";
import { DELETE, PUT } from "./route";

const mockedDb = db as any;
const mockedEmail = emailService as any;

const BUSINESS = { id: "biz_1", ownerId: "user_1", name: "Acme Salon" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

const NEW_START = new Date(Date.now() + 48 * 60 * 60 * 1000);
const NEW_END = new Date(NEW_START.getTime() + 60 * 60 * 1000);

const EXISTING_BOOKING = {
  id: "bkg_1",
  slug: "haircut-jane-123",
  businessId: BUSINESS.id,
  serviceId: "cservice0000000000000001",
  status: "PENDING",
  clientEmail: "jane@example.com",
  startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
  endTime: new Date(Date.now() + 25 * 60 * 60 * 1000),
  business: { ownerId: USER.id, name: BUSINESS.name },
  service: { duration: 60, name: "Haircut" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
  mockedDb.booking.findUnique.mockResolvedValue(EXISTING_BOOKING);
  mockedDb.booking.findFirst.mockResolvedValue(null);
});

describe("PUT /api/bookings/[slug]", () => {
  beforeEach(() => {
    mockedDb.booking.update.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        ...EXISTING_BOOKING,
        ...args.data,
      }),
    );
  });

  it("scopes the overlap check by businessId, not serviceId", async () => {
    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: {
        startTime: NEW_START.toISOString(),
        endTime: NEW_END.toISOString(),
      },
    });

    const response = await PUT(request, {
      params: Promise.resolve({ slug: EXISTING_BOOKING.slug }),
    });

    expect(response.status).toBe(200);
    expect(mockedDb.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: BUSINESS.id }),
      }),
    );
    const calledWhere = mockedDb.booking.findFirst.mock.calls[0]![0].where;
    expect(calledWhere).not.toHaveProperty("serviceId");
  });

  it("rejects the reschedule when it overlaps a booking on a different service of the same business", async () => {
    mockedDb.booking.findFirst.mockResolvedValue({ id: "other_bkg" });

    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: {
        startTime: NEW_START.toISOString(),
        endTime: NEW_END.toISOString(),
      },
    });

    const response = await PUT(request, {
      params: Promise.resolve({ slug: EXISTING_BOOKING.slug }),
    });

    expect(response.status).toBe(400);
    expect(mockedDb.booking.update).not.toHaveBeenCalled();
  });

  it("sends a reschedule email when startTime/endTime change", async () => {
    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: {
        startTime: NEW_START.toISOString(),
        endTime: NEW_END.toISOString(),
      },
    });

    await PUT(request, { params: Promise.resolve({ slug: EXISTING_BOOKING.slug }) });

    expect(mockedEmail.sendBookingRescheduledEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: EXISTING_BOOKING.clientEmail,
        businessName: BUSINESS.name,
        serviceName: EXISTING_BOOKING.service.name,
      }),
    );
    expect(mockedEmail.sendBookingCancellationEmail).not.toHaveBeenCalled();
  });

  it("sends a cancellation email (not a reschedule email) when status transitions to CANCELLED", async () => {
    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: { status: "CANCELLED" },
    });

    await PUT(request, { params: Promise.resolve({ slug: EXISTING_BOOKING.slug }) });

    expect(mockedEmail.sendBookingCancellationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: EXISTING_BOOKING.clientEmail }),
    );
    expect(mockedEmail.sendBookingRescheduledEmail).not.toHaveBeenCalled();
  });

  it("still returns success when the notification email throws", async () => {
    mockedEmail.sendBookingRescheduledEmail.mockRejectedValue(
      new Error("Resend down"),
    );

    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: {
        startTime: NEW_START.toISOString(),
        endTime: NEW_END.toISOString(),
      },
    });

    const response = await PUT(request, {
      params: Promise.resolve({ slug: EXISTING_BOOKING.slug }),
    });

    expect(response.status).toBe(200);
  });
});

describe("DELETE /api/bookings/[slug]", () => {
  beforeEach(() => {
    mockedDb.booking.update.mockResolvedValue({
      ...EXISTING_BOOKING,
      status: "CANCELLED",
    });
  });

  it("sends a cancellation email on successful cancellation", async () => {
    const request = createMockRequest({
      method: "DELETE",
      cookies: authenticatedCookies(),
    });

    const response = await DELETE(request, {
      params: Promise.resolve({ slug: EXISTING_BOOKING.slug }),
    });

    expect(response.status).toBe(200);
    expect(mockedEmail.sendBookingCancellationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: EXISTING_BOOKING.clientEmail,
        businessName: BUSINESS.name,
        serviceName: EXISTING_BOOKING.service.name,
      }),
    );
  });

  it("still cancels successfully when the notification email throws", async () => {
    mockedEmail.sendBookingCancellationEmail.mockRejectedValue(
      new Error("Resend down"),
    );

    const request = createMockRequest({
      method: "DELETE",
      cookies: authenticatedCookies(),
    });

    const response = await DELETE(request, {
      params: Promise.resolve({ slug: EXISTING_BOOKING.slug }),
    });

    expect(response.status).toBe(200);
    expect(mockedDb.booking.update).toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    payment: { findUnique: vi.fn(), create: vi.fn() },
    booking: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/backend/services/paystack", () => ({
  paystackService: {
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
  },
}));

vi.mock("@/backend/services/email", () => ({
  emailService: {
    sendBookingConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("@/backend/services/googleCalendar", () => ({
  googleCalendarService: {
    createEvent: vi.fn().mockResolvedValue(null),
  },
}));

import { emailService } from "@/backend/services/email";
import { googleCalendarService } from "@/backend/services/googleCalendar";
import { db } from "@/server/db";
import { POST } from "./route";

const mockedDb = db as any;
const mockedEmail = emailService as any;
const mockedCalendar = googleCalendarService as any;

const BOOKING = {
  id: "bkg_1",
  status: "PENDING",
  businessId: "biz_1",
  startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
  endTime: new Date(Date.now() + 25 * 60 * 60 * 1000),
  notes: null,
  clientName: "Jane Doe",
  clientEmail: "jane@example.com",
  clientPhone: null,
  service: { name: "Haircut" },
  business: {
    id: "biz_1",
    name: "Acme Salon",
    googleCalendarId: null,
    googleCalendarAccessToken: null,
    googleCalendarRefreshToken: "refresh-1",
    googleCalendarTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
  },
};

function buildEvent() {
  return {
    event: "charge.success",
    data: {
      id: 1,
      reference: "ref_123",
      amount: 5000,
      currency: "USD",
      channel: "card",
      status: "success",
      paid_at: new Date().toISOString(),
      metadata: { bookingId: BOOKING.id, businessId: BOOKING.businessId },
      customer: { email: "jane@example.com", first_name: "Jane", last_name: "Doe" },
    },
  };
}

function buildRequest(event: unknown) {
  const body = JSON.stringify(event);
  return {
    text: async () => body,
    headers: { get: () => "valid-signature" },
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.payment.findUnique.mockResolvedValue(null);
  mockedDb.booking.findUnique.mockResolvedValue(BOOKING);
  mockedDb.$transaction.mockImplementation(async (cb: (tx: typeof mockedDb) => unknown) =>
    cb(mockedDb),
  );
});

describe("POST /api/webhooks/paystack charge.success", () => {
  it("sends a booking confirmation email after confirming the booking", async () => {
    const response = await POST(buildRequest(buildEvent()));

    expect(response.status).toBe(200);
    expect(mockedEmail.sendBookingConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: BOOKING.clientEmail,
        businessName: BOOKING.business.name,
        serviceName: BOOKING.service.name,
      }),
    );
  });

  it("still returns 200 when the confirmation email fails", async () => {
    mockedEmail.sendBookingConfirmationEmail.mockRejectedValue(
      new Error("Resend down"),
    );

    const response = await POST(buildRequest(buildEvent()));

    expect(response.status).toBe(200);
  });

  it("does not send an email when the booking has no client email and no customer email fallback", async () => {
    mockedDb.booking.findUnique.mockResolvedValue({
      ...BOOKING,
      clientEmail: null,
    });
    const event = buildEvent();
    event.data.customer.email = "";

    await POST(buildRequest(event));

    expect(mockedEmail.sendBookingConfirmationEmail).not.toHaveBeenCalled();
  });

  it("creates a Calendar event and persists the returned googleEventId", async () => {
    mockedCalendar.createEvent.mockResolvedValue({ googleEventId: "evt_1" });

    await POST(buildRequest(buildEvent()));

    expect(mockedCalendar.createEvent).toHaveBeenCalledWith(
      BOOKING.business,
      expect.objectContaining({ id: BOOKING.id }),
      BOOKING.service,
    );
    expect(mockedDb.booking.update).toHaveBeenCalledWith({
      where: { id: BOOKING.id },
      data: { googleEventId: "evt_1" },
    });
  });

  it("still returns 200 when the Calendar sync fails", async () => {
    mockedCalendar.createEvent.mockRejectedValue(new Error("Google API down"));

    const response = await POST(buildRequest(buildEvent()));

    expect(response.status).toBe(200);
    expect(mockedDb.booking.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { googleEventId: expect.anything() } }),
    );
  });
});

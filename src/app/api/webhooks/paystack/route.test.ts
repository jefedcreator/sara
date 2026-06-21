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

import { emailService } from "@/backend/services/email";
import { db } from "@/server/db";
import { POST } from "./route";

const mockedDb = db as any;
const mockedEmail = emailService as any;

const BOOKING = {
  id: "bkg_1",
  status: "PENDING",
  businessId: "biz_1",
  startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
  clientName: "Jane Doe",
  clientEmail: "jane@example.com",
  clientPhone: null,
  service: { name: "Haircut" },
  business: { name: "Acme Salon" },
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
});

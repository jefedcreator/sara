import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    payment: { findUnique: vi.fn(), create: vi.fn() },
    booking: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/backend/services/paystack", () => ({
  paystackService: {
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
    verifyTransaction: vi.fn(),
  },
}));

vi.mock("@/backend/services/email", () => ({
  emailService: {
    sendBookingConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
    sendNewBookingEmail: vi.fn().mockResolvedValue({ success: true }),
    sendBookingCancellationEmail: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("@/backend/services/googleCalendar", () => ({
  googleCalendarService: {
    createEvent: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@/backend/services/receipt", () => ({
  receiptService: {
    create: vi.fn().mockResolvedValue({ slug: "acme-rcp-1001", publicId: "b7T0qLm2Vn9cZ4wE", url: "https://cdn.test/r.pdf" }),
  },
}));

vi.mock("@/backend/services/messaging/notify", () => ({
  ownerNotifier: { notify: vi.fn().mockResolvedValue(undefined) },
}));

import { emailService } from "@/backend/services/email";
import { googleCalendarService } from "@/backend/services/googleCalendar";
import { ownerNotifier } from "@/backend/services/messaging/notify";
import { paystackService } from "@/backend/services/paystack";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";
import { GET, POST } from "./route";

const mockedDb = db as any;
const mockedPaystack = paystackService as any;
const mockedEmail = emailService as any;
const mockedCalendar = googleCalendarService as any;
const mockedReceipt = receiptService as any;
const mockedNotifier = ownerNotifier as any;

const BOOKING = {
  id: "bkg_1",
  publicId: "Pq8sN1xV0kL3mA6t",
  status: "PENDING",
  businessId: "biz_1",
  serviceId: "svc_1",
  units: 1,
  amount: 50,
  holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
  startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
  endTime: new Date(Date.now() + 25 * 60 * 60 * 1000),
  notes: null,
  clientName: "Jane Doe",
  clientEmail: "jane@example.com",
  clientPhone: null,
  service: { id: "svc_1", name: "Haircut", slug: "haircut", duration: 45, price: 50, bookingMode: "SLOT" },
  business: {
    id: "biz_1",
    name: "Acme Salon",
    email: "hello@acme.test",
    currency: "NGN",
    owner: { email: "owner@acme.test" },
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
  // First call: idempotency check (must return null to proceed).
  // Second call: payment lookup inside receipt creation.
  mockedDb.payment.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValue({ id: "pay_1" });
  mockedDb.booking.findUnique.mockResolvedValue(BOOKING);
  mockedDb.booking.findFirst.mockResolvedValue(null);
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
        business: expect.objectContaining({ name: BOOKING.business.name }),
        serviceName: BOOKING.service.name,
        duration: 45,
        amount: 50,
        receiptUrl: expect.stringMatching(/\/receipts\/b7T0qLm2Vn9cZ4wE$/),
        bookingUrl: expect.stringMatching(/\/bookings\/Pq8sN1xV0kL3mA6t$/),
      }),
    );
  });

  it("emails the owner about the paid booking", async () => {
    await POST(buildRequest(buildEvent()));

    expect(mockedEmail.sendNewBookingEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@acme.test",
        clientName: BOOKING.clientName,
        serviceName: BOOKING.service.name,
        amount: 50,
        currency: "NGN",
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

  it("creates a receipt and notifies the owner after confirming the booking", async () => {
    const response = await POST(buildRequest(buildEvent()));

    expect(response.status).toBe(200);
    expect(mockedReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BOOKING.businessId,
        paymentId: "pay_1",
        paymentMethod: "PAYSTACK",
        currency: BOOKING.business.currency,
        total: 50,
        amountPaid: 50,
      }),
    );
    expect(mockedNotifier.notify).toHaveBeenCalledWith(
      BOOKING.businessId,
      expect.stringContaining(BOOKING.service.name),
    );
    // The receipt's share page, not the bare PDF.
    expect(mockedNotifier.notify).toHaveBeenCalledWith(
      BOOKING.businessId,
      expect.stringMatching(/\nReceipt: https?:\/\/\S+\/receipts\/b7T0qLm2Vn9cZ4wE$/),
    );
  });

  it("still returns 200 and still attempts owner notification when receipt creation fails", async () => {
    mockedReceipt.create.mockRejectedValue(new Error("Receipt service down"));

    const response = await POST(buildRequest(buildEvent()));

    expect(response.status).toBe(200);
    expect(mockedNotifier.notify).toHaveBeenCalledWith(
      BOOKING.businessId,
      expect.stringContaining(BOOKING.service.name),
    );
  });

  it("still returns 200 when owner notification fails", async () => {
    mockedNotifier.notify.mockRejectedValue(new Error("Notify channel down"));

    const response = await POST(buildRequest(buildEvent()));

    expect(response.status).toBe(200);
  });
  it("puts the service on the receipt as a line, quantity = units", async () => {
    mockedDb.booking.findUnique.mockResolvedValue({
      ...BOOKING,
      units: 3,
      service: { ...BOOKING.service, name: "Lekki 2-bed 4B", bookingMode: "NIGHTLY", price: 50 / 3 },
    });
    await POST(buildRequest(buildEvent()));
    expect(mockedReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        services: [
          expect.objectContaining({ serviceId: "svc_1", quantity: 3, unitPrice: 50 / 3, total: 50 }),
        ],
      }),
    );
  });

  it("confirms a late payment when the time is still free", async () => {
    mockedDb.booking.findUnique.mockResolvedValue({ ...BOOKING, holdExpiresAt: new Date(Date.now() - 60 * 1000) });
    await POST(buildRequest(buildEvent()));
    expect(mockedDb.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: "bkg_1" } }) }),
    );
    expect(mockedDb.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CONFIRMED" } }),
    );
  });

  it("retries once when the serializable transaction loses a race", async () => {
    const real = mockedDb.$transaction.getMockImplementation();
    mockedDb.$transaction.mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "P2034" }));
    mockedDb.$transaction.mockImplementation(real);
    const response = await POST(buildRequest(buildEvent()));
    expect(response.status).toBe(200);
    expect(mockedDb.$transaction).toHaveBeenCalledTimes(2);
    expect(mockedDb.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CONFIRMED" } }),
    );
  });

  it("returns 500 when serialization fails twice to force a retry", async () => {
    mockedDb.$transaction.mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "P2034" }));
    mockedDb.$transaction.mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "P2034" }));
    
    const response = await POST(buildRequest(buildEvent()));
    expect(response.status).toBe(500);
    expect(mockedDb.$transaction).toHaveBeenCalledTimes(2);
    const body = await response.json();
    expect(body.message).toBe("Serialization conflict, please retry");
  });

  it("cancels a late payment whose time was resold, and tells the owner to refund", async () => {
    mockedDb.booking.findUnique.mockResolvedValue({ ...BOOKING, holdExpiresAt: new Date(Date.now() - 60 * 1000) });
    mockedDb.booking.findFirst.mockResolvedValue({ id: "bkg_other" });

    const response = await POST(buildRequest(buildEvent()));

    expect(response.status).toBe(200);
    expect(mockedDb.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELLED" } }),
    );
    expect(mockedDb.payment.create).toHaveBeenCalled();
    expect(mockedReceipt.create).not.toHaveBeenCalled();
    expect(mockedEmail.sendBookingConfirmationEmail).not.toHaveBeenCalled();
    expect(mockedEmail.sendBookingCancellationEmail).toHaveBeenCalled();
    expect(mockedNotifier.notify).toHaveBeenCalledWith(
      BOOKING.businessId,
      expect.stringContaining("Refund it from your Paystack dashboard"),
    );
  });

  it("records which booking the payment was for, so the booking finds its receipt", async () => {
    await POST(buildRequest(buildEvent()));
    expect(mockedDb.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ bookingId: BOOKING.id, reference: "ref_123" }),
    });
  });
});

describe("GET /api/webhooks/paystack", () => {
  it("redirects immediately to the booking page when payment already exists", async () => {
    mockedDb.payment.findUnique.mockReset();
    mockedDb.payment.findUnique.mockResolvedValue({
      id: "pay_1",
      reference: "ref_existing",
      booking: { publicId: BOOKING.publicId },
    });

    const req = new Request("http://localhost:3000/api/webhooks/paystack?reference=ref_existing");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`http://localhost:3000/bookings/${BOOKING.publicId}`);
    expect(mockedPaystack.verifyTransaction).not.toHaveBeenCalled();
  });

  it("verifies with Paystack and confirms booking when payment does not exist yet", async () => {
    mockedDb.payment.findUnique.mockReset();
    mockedDb.payment.findUnique
      .mockResolvedValueOnce(null) // GET check for existing payment
      .mockResolvedValueOnce(null) // processSuccessfulPayment idempotency check
      .mockResolvedValue({ id: "pay_1" }); // receipt creation payment lookup
    mockedPaystack.verifyTransaction.mockResolvedValue({
      status: "success",
      reference: "ref_new",
      amount: 5000,
      currency: "NGN",
      channel: "card",
      metadata: { bookingId: BOOKING.id, businessId: BOOKING.businessId },
      customer: { email: "jane@example.com", first_name: "Jane", last_name: "Doe" },
    });

    const req = new Request("http://localhost:3000/api/webhooks/paystack?reference=ref_new");
    const res = await GET(req);

    expect(mockedPaystack.verifyTransaction).toHaveBeenCalledWith("ref_new");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`http://localhost:3000/bookings/${BOOKING.publicId}`);
    expect(mockedDb.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CONFIRMED" } }),
    );
  });

  it("redirects to booking page when only booking slug 'b' is given", async () => {
    mockedDb.booking.findUnique.mockResolvedValueOnce({
      id: "bkg_1",
      publicId: BOOKING.publicId,
    });

    const req = new Request("http://localhost:3000/api/webhooks/paystack?b=haircut-ada");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`http://localhost:3000/bookings/${BOOKING.publicId}`);
  });

  it("falls back to home page when no query params are provided", async () => {
    const req = new Request("http://localhost:3000/api/webhooks/paystack");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });
});


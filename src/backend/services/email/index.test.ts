import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, ResendMock, env } = vi.hoisted(() => {
  const sendMock = vi.fn();
  return {
    sendMock,
    ResendMock: vi.fn().mockImplementation(function MockResend() {
      return { emails: { send: sendMock } };
    }),
    env: Object.create(null) as Record<string, string | undefined>,
  };
});

vi.mock("resend", () => ({ Resend: ResendMock }));
vi.mock("@/env", () => ({ env }));

/** A fresh service, so each test chooses its sender from its own env. */
async function freshService() {
  vi.resetModules();
  const { emailService } = await import("./index");
  return emailService;
}

const CONFIRMATION = {
  to: "ada@example.com",
  business: { name: "Acme Salon", email: "hello@acme.test" },
  serviceName: "Knotless braids",
  // Slot times are wall-clock UTC: this is 09:00 as the owner typed it.
  startTime: new Date("2026-06-22T09:00:00.000Z"),
  duration: 240,
  amount: 25000,
  currency: "NGN",
  receiptUrl: "https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE",
  bookingUrl: "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(env)) delete env[key];
  env.NEXT_PUBLIC_APP_URL = "https://app.sara.ng";
  env.RESEND_API_KEY = "re_test";
});

describe("emailService with Resend", () => {
  it("sends the rendered confirmation from the default sender, replying to the business", async () => {
    sendMock.mockResolvedValue({ data: { id: "email_1" }, error: null });
    const emailService = await freshService();

    const result =
      await emailService.sendBookingConfirmationEmail(CONFIRMATION);

    expect(result).toEqual({ success: true });
    const sent = sendMock.mock.calls[0]![0] as Record<string, string>;
    expect(sent).toMatchObject({
      from: "Sara <bookings@sara.app>",
      to: "ada@example.com",
      replyTo: "hello@acme.test",
      subject: "Your booking with Acme Salon is confirmed",
    });
    expect(sent.html).toContain("Mon 22 Jun at 09:00");
    expect(sent.html).toContain(
      'href="https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE"',
    );
    expect(sent.text).toContain("Knotless braids");
    expect(sent.text).toContain("NGN 25,000");
  }, 15000);

  it("sends from EMAIL_FROM when it's set", async () => {
    env.EMAIL_FROM = "Sara <hello@sara.ng>";
    sendMock.mockResolvedValue({ data: { id: "email_2" }, error: null });
    const emailService = await freshService();

    await emailService.sendWelcomeEmail({
      to: "tolu@example.com",
      name: "Tolu",
    });

    expect(ResendMock).toHaveBeenCalledWith("re_test");
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Sara <hello@sara.ng>",
        subject: "Welcome to Sara",
      }),
    );
  });

  it("reports, not throws, when Resend rejects the send", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "bad from" },
    });
    const emailService = await freshService();

    const result = await emailService.sendBookingCancellationEmail({
      to: "ada@example.com",
      business: { name: "Acme Salon" },
      serviceName: "Haircut",
      serviceSlug: "acme-haircut",
      startTime: new Date("2026-06-22T09:00:00.000Z"),
    });

    expect(result.success).toBe(false);
  });

  it("reports, not throws, when Resend itself throws", async () => {
    sendMock.mockRejectedValue(new Error("network error"));
    const emailService = await freshService();

    const result = await emailService.sendBookingReminderEmail({
      to: "ada@example.com",
      business: { name: "Acme Salon" },
      serviceName: "Haircut",
      startTime: new Date("2026-06-22T09:00:00.000Z"),
      bookingUrl: "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",
    });

    expect(result.success).toBe(false);
  });
});

describe("emailService without a Resend key", () => {
  it("prints the email instead, and never builds a Resend client", async () => {
    delete env.RESEND_API_KEY;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const emailService = await freshService();

    const result = await emailService.sendWelcomeEmail({
      to: "tolu@example.com",
      name: "Tolu",
    });

    expect(result).toEqual({ success: true });
    expect(ResendMock).not.toHaveBeenCalled();
    const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("subject: Welcome to Sara");
    expect(printed).toContain("https://app.sara.ng/onboarding");
    log.mockRestore();
  });
});

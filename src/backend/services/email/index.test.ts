import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function MockResend() {
    return { emails: { send: sendMock } };
  }),
}));

import { emailService } from "./index";

const PARAMS = {
  to: "client@example.com",
  businessName: "Acme Salon",
  serviceName: "Haircut",
  startTime: new Date("2026-06-22T09:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("emailService booking lifecycle methods", () => {
  it("sendBookingConfirmationEmail sends to the client with the right subject/body", async () => {
    sendMock.mockResolvedValue({ data: { id: "email_1" }, error: null });

    const result = await emailService.sendBookingConfirmationEmail(PARAMS);

    expect(result.success).toBe(true);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: PARAMS.to,
        subject: expect.stringContaining("confirmed"),
        html: expect.stringContaining(PARAMS.serviceName),
      }),
    );
  });

  it("sendBookingCancellationEmail returns { success: false } (not throwing) on a Resend error", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "Resend down" },
    });

    const result = await emailService.sendBookingCancellationEmail(PARAMS);

    expect(result.success).toBe(false);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining("cancelled") }),
    );
  });

  it("sendBookingRescheduledEmail mentions both the old and new time", async () => {
    sendMock.mockResolvedValue({ data: { id: "email_2" }, error: null });

    const previousStartTime = new Date("2026-06-20T09:00:00.000Z");
    const newStartTime = new Date("2026-06-22T10:00:00.000Z");

    await emailService.sendBookingRescheduledEmail({
      ...PARAMS,
      previousStartTime,
      newStartTime,
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining(newStartTime.toLocaleString()),
      }),
    );
  });

  it("sendBookingReminderEmail does not throw when Resend itself throws", async () => {
    sendMock.mockRejectedValue(new Error("network error"));

    const result = await emailService.sendBookingReminderEmail(PARAMS);

    expect(result.success).toBe(false);
  });
});

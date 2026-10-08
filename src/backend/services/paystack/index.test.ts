import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { paystackService } from "./index";

describe("paystackService.verifyWebhookSignature", () => {
  it("verifies signature using PAYSTACK_SECRET_KEY when WEBHOOK_SECRET is unset", () => {
    const rawBody = JSON.stringify({ event: "charge.success", data: { reference: "ref_1" } });
    const secretKey = process.env.PAYSTACK_SECRET_KEY || "sk_test_mock";
    const signature = crypto.createHmac("sha512", secretKey).update(rawBody).digest("hex");

    expect(paystackService.verifyWebhookSignature(rawBody, signature)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const rawBody = JSON.stringify({ event: "charge.success", data: { reference: "ref_1" } });
    expect(paystackService.verifyWebhookSignature(rawBody, "invalid-signature")).toBe(false);
  });

  it("safely returns false instead of throwing if secret key cannot be resolved", () => {
    const originalSecret = process.env.PAYSTACK_SECRET_KEY;
    const originalWebhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET;
    delete process.env.PAYSTACK_SECRET_KEY;
    delete process.env.PAYSTACK_WEBHOOK_SECRET;

    // Even if no keys exist, verifyWebhookSignature returns false safely
    const result = paystackService.verifyWebhookSignature("{}", "fake");
    expect(result).toBe(false);

    if (originalSecret) process.env.PAYSTACK_SECRET_KEY = originalSecret;
    if (originalWebhookSecret) process.env.PAYSTACK_WEBHOOK_SECRET = originalWebhookSecret;
  });
});


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
});


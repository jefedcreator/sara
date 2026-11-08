import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

const env = vi.hoisted(() => ({
  PAYSTACK_SECRET_KEY: "sk_test_mock" as string | undefined,
  PAYSTACK_WEBHOOK_SECRET: undefined as string | undefined,
}));

vi.mock("@/env", () => ({ env }));

import { paystackService } from "./index";

describe("paystackService.verifyWebhookSignature", () => {
  it("verifies signature using PAYSTACK_SECRET_KEY when WEBHOOK_SECRET is unset", () => {
    env.PAYSTACK_SECRET_KEY = "sk_test_mock";
    env.PAYSTACK_WEBHOOK_SECRET = undefined;
    const rawBody = JSON.stringify({ event: "charge.success", data: { reference: "ref_1" } });
    const secretKey = "sk_test_mock";
    const signature = crypto.createHmac("sha512", secretKey).update(rawBody).digest("hex");

    expect(paystackService.verifyWebhookSignature(rawBody, signature)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    env.PAYSTACK_SECRET_KEY = "sk_test_mock";
    env.PAYSTACK_WEBHOOK_SECRET = undefined;
    const rawBody = JSON.stringify({ event: "charge.success", data: { reference: "ref_1" } });
    expect(paystackService.verifyWebhookSignature(rawBody, "invalid-signature")).toBe(false);
  });

  it("safely returns false instead of throwing if secret key cannot be resolved", () => {
    env.PAYSTACK_SECRET_KEY = undefined;
    env.PAYSTACK_WEBHOOK_SECRET = undefined;

    const result = paystackService.verifyWebhookSignature("{}", "fake");
    expect(result).toBe(false);
  });
});

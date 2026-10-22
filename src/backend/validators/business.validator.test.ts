import { describe, expect, it } from "vitest";

import {
  businessValidatorSchema,
  updateBusinessValidatorSchema,
} from "./business.validator";

describe("updateBusinessValidatorSchema selling fields", () => {
  it("needs a delivery fee when delivery is on", () => {
    const result = updateBusinessValidatorSchema.safeParse({
      offersDelivery: true,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Set a delivery fee, or 0 for free delivery",
    );
  });

  it("allows 0 for free delivery", () => {
    expect(
      updateBusinessValidatorSchema.safeParse({
        offersDelivery: true,
        deliveryFee: 0,
      }).success,
    ).toBe(true);
  });

  it("accepts what you sell, delivery and pickup", () => {
    expect(
      updateBusinessValidatorSchema.parse({
        sells: "BOTH",
        offersDelivery: true,
        deliveryFee: 3000,
        offersPickup: true,
      }),
    ).toEqual({
      sells: "BOTH",
      offersDelivery: true,
      deliveryFee: 3000,
      offersPickup: true,
    });
  });

  it("allows a null fee while delivery is off", () => {
    expect(
      updateBusinessValidatorSchema.safeParse({
        offersDelivery: false,
        deliveryFee: null,
      }).success,
    ).toBe(true);
  });

  it("rejects a negative delivery fee", () => {
    expect(
      updateBusinessValidatorSchema.safeParse({
        offersDelivery: true,
        deliveryFee: -1,
      }).success,
    ).toBe(false);
  });
});

describe("businessValidatorSchema selling fields", () => {
  it("reads the strings multipart onboarding sends", () => {
    const parsed = businessValidatorSchema.parse({
      name: "Tobi Beauty",
      monoCode: "code_test",
      sells: "PRODUCTS",
      offersDelivery: "true",
      deliveryFee: "3000",
      offersPickup: "true",
    });

    expect(parsed).toMatchObject({
      sells: "PRODUCTS",
      offersDelivery: true,
      deliveryFee: 3000,
      offersPickup: true,
    });
  });
});

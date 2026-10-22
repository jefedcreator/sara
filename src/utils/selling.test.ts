import { describe, expect, it } from "vitest";

import { canSellOnline } from "./selling";

describe("canSellOnline", () => {
  it("is true when payments are ready and pickup is offered", () => {
    expect(
      canSellOnline({
        isPaymentReady: true,
        offersDelivery: false,
        offersPickup: true,
      }),
    ).toBe(true);
  });

  it("is false until payment is ready", () => {
    expect(
      canSellOnline({
        isPaymentReady: false,
        offersDelivery: true,
        offersPickup: true,
      }),
    ).toBe(false);
  });

  it("is false when neither delivery nor pickup is offered", () => {
    expect(
      canSellOnline({
        isPaymentReady: true,
        offersDelivery: false,
        offersPickup: false,
      }),
    ).toBe(false);
  });
});

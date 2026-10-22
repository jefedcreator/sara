import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.sara.ng" } }));

import {
  availabilityNote,
  capQuantity,
  firstAvailableOption,
  productMetadata,
  type ProductPage,
} from "./product-page";

const WIG: ProductPage = {
  slug: "frontal-wig",
  name: "Frontal wig",
  description: "Hand-tied and ready to wear.",
  photos: ["https://res.cloudinary.com/demo/wig.jpg"],
  price: "45000",
  currency: "NGN",
  businessName: "Tobi Hair",
  area: "Lekki, Lagos",
  canBuy: true,
  offersDelivery: true,
  deliveryFee: "3000",
  offersPickup: true,
  pickupAddress: "12 Admiralty Way, Lekki, Lagos",
  options: [
    { id: "opt_20", name: '20"', price: "45000", available: 3 },
    { id: "opt_22", name: '22"', price: "50000", available: 0 },
  ],
};

describe("availabilityNote", () => {
  it("names low stock from three down, and sold out at zero", () => {
    expect(availabilityNote(3)).toBe("Only 3 left");
    expect(availabilityNote(1)).toBe("Only 1 left");
    expect(availabilityNote(0)).toBe("Sold out");
    expect(availabilityNote(-1)).toBe("Sold out");
  });

  it("stays quiet with comfortable stock or a made-to-order product", () => {
    expect(availabilityNote(4)).toBeNull();
    expect(availabilityNote(null)).toBeNull();
  });
});

describe("firstAvailableOption", () => {
  it("lands on the first option a customer can buy", () => {
    expect(
      firstAvailableOption([
        { id: "a", name: "A", price: "1", available: 0 },
        { id: "b", name: "B", price: "1", available: 2 },
      ])?.id,
    ).toBe("b");
  });

  it("keeps the first option when everything is sold out, and null with no options", () => {
    expect(
      firstAvailableOption([{ id: "a", name: "A", price: "1", available: 0 }])?.id,
    ).toBe("a");
    expect(firstAvailableOption([])).toBeNull();
  });
});

describe("capQuantity", () => {
  it("keeps the stepper between one and what is left", () => {
    expect(capQuantity(5, 3)).toBe(3);
    expect(capQuantity(0, 3)).toBe(1);
    expect(capQuantity(2, 3)).toBe(2);
  });

  it("has no ceiling when the product is made to order", () => {
    expect(capQuantity(50, null)).toBe(50);
  });
});

describe("productMetadata", () => {
  it("says what it costs, from whom, and what happens next", () => {
    const metadata = productMetadata(WIG, "/products/frontal-wig");
    expect(metadata.title).toBe("Frontal wig · Tobi Hair");
    expect(metadata.description).toBe(
      "NGN 45,000 from Tobi Hair in Lekki, Lagos. Pick your option and pay with Paystack.",
    );
    expect(metadata.alternates?.canonical).toBe(
      "https://app.sara.ng/products/frontal-wig",
    );
    expect(metadata.robots).toBeUndefined();
  });

  it("tells the customer to message the business when online checkout is off", () => {
    expect(
      productMetadata({ ...WIG, canBuy: false }, "/products/frontal-wig").description,
    ).toBe(
      "NGN 45,000 from Tobi Hair in Lekki, Lagos. Message Tobi Hair to order.",
    );
  });

  it("previews an unknown or paused product as a dead link, unindexed", () => {
    const metadata = productMetadata(null, "/products/nope");
    expect(metadata.title).toBe("Link not found · Sara");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

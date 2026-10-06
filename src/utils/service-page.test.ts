import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.sara.ng" } }));

import {
  serviceMetadata,
  servicePriceLine,
  serviceTerms,
  type ServicePage,
} from "./service-page";

const BRAIDS: ServicePage = {
  slug: "acme-knotless-braids",
  name: "Knotless braids",
  image: null,
  price: "25000",
  duration: 240,
  bookingMode: "SLOT",
  description: null,
  currency: "NGN",
  checkInTime: null,
  checkOutTime: null,
  minUnits: 1,
  maxUnits: 30,
  businessName: "Acme Salon",
  others: [],
};

const STAY: ServicePage = {
  ...BRAIDS,
  slug: "lekki-4b",
  name: "Lekki 2-bed 4B",
  price: "85000",
  duration: 1440,
  bookingMode: "NIGHTLY",
  checkInTime: "14:00",
  checkOutTime: "11:00",
  minUnits: 2,
  maxUnits: 14,
  businessName: "Lekki Stays",
};

describe("servicePriceLine", () => {
  it("prices a slot with its length and a stay or rental per unit", () => {
    expect(servicePriceLine(BRAIDS)).toBe("NGN 25,000 · 4 hr");
    expect(servicePriceLine(STAY)).toBe("NGN 85,000 per night");
    expect(servicePriceLine({ ...STAY, bookingMode: "DAILY", price: "70000" })).toBe(
      "NGN 70,000 per day",
    );
  });
});

describe("serviceTerms", () => {
  it("gives a slot its length", () => {
    expect(serviceTerms(BRAIDS)).toEqual([{ label: "Length", value: "4 hr" }]);
  });

  it("gives a stay its check-in, check-out and length range", () => {
    expect(serviceTerms(STAY)).toEqual([
      { label: "Check-in", value: "From 14:00" },
      { label: "Check-out", value: "By 11:00" },
      { label: "Stays", value: "2 to 14 nights" },
    ]);
  });

  it("never says '3 to 3' when there is no choice", () => {
    expect(serviceTerms({ ...STAY, minUnits: 3, maxUnits: 3 }).at(-1)).toEqual({
      label: "Stays",
      value: "3 nights",
    });
    expect(
      serviceTerms({ ...STAY, bookingMode: "DAILY", minUnits: 1, maxUnits: 1 }),
    ).toEqual([
      { label: "Days", value: "24 hours from pickup" },
      { label: "Rentals", value: "1 day" },
    ]);
  });

  it("gives a rental its day rule and range", () => {
    expect(serviceTerms({ ...STAY, bookingMode: "DAILY", minUnits: 1, maxUnits: 7 })).toEqual([
      { label: "Days", value: "24 hours from pickup" },
      { label: "Rentals", value: "1 to 7 days" },
    ]);
  });
});

describe("serviceMetadata", () => {
  it("says what it costs, from whom, and what happens next", () => {
    const metadata = serviceMetadata(BRAIDS, "/services/acme-knotless-braids");
    expect(metadata.title).toBe("Knotless braids · Acme Salon");
    expect(metadata.description).toBe(
      "NGN 25,000 for 4 hr with Acme Salon. Pick a time and pay with Paystack.",
    );
    expect(metadata.alternates?.canonical).toBe(
      "https://app.sara.ng/services/acme-knotless-braids",
    );
    expect(metadata.robots).toBeUndefined();
    expect(serviceMetadata(STAY, "/services/lekki-4b").description).toBe(
      "NGN 85,000 a night with Lekki Stays. Pick your dates and pay with Paystack.",
    );
  });

  it("previews an unknown or paused service as a dead link, unindexed", () => {
    const metadata = serviceMetadata(null, "/services/nope");
    expect(metadata.title).toBe("Link not found · Sara");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

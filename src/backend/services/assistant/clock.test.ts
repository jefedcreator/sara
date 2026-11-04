import { describe, expect, it } from "vitest";

import { lagosDay, periodRange } from "./clock";

describe("lagosDay", () => {
  it("uses the Lagos date even before UTC midnight", () => {
    expect(lagosDay(new Date("2026-11-03T23:30:00Z"))).toBe("2026-11-04");
    expect(lagosDay(new Date("2026-11-04T22:59:59Z"))).toBe("2026-11-04");
    expect(lagosDay(new Date("2026-11-04T23:00:00Z"))).toBe("2026-11-05");
  });
});

describe("periodRange", () => {
  it("starts today at Lagos midnight", () => {
    expect(periodRange("today", new Date("2026-11-04T12:00:00Z"))).toEqual({
      from: new Date("2026-11-03T23:00:00Z"),
      to: new Date("2026-11-04T23:00:00Z"),
    });
  });

  it("returns the Monday-first Lagos week", () => {
    expect(periodRange("week", new Date("2026-11-04T12:00:00Z"))).toEqual({
      from: new Date("2026-11-01T23:00:00Z"),
      to: new Date("2026-11-08T23:00:00Z"),
    });
  });

  it("keeps Sunday in the week that began the previous Monday", () => {
    expect(periodRange("week", new Date("2026-11-08T12:00:00Z"))).toEqual({
      from: new Date("2026-11-01T23:00:00Z"),
      to: new Date("2026-11-08T23:00:00Z"),
    });
  });

  it("uses Lagos month boundaries", () => {
    expect(periodRange("month", new Date("2026-11-04T12:00:00Z"))).toEqual({
      from: new Date("2026-10-31T23:00:00Z"),
      to: new Date("2026-11-30T23:00:00Z"),
    });
  });

  it("rolls December into the next Lagos year", () => {
    expect(periodRange("month", new Date("2026-12-31T23:30:00Z"))).toEqual({
      from: new Date("2026-12-31T23:00:00Z"),
      to: new Date("2027-01-31T23:00:00Z"),
    });
  });
});

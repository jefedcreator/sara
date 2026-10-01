import { describe, expect, it } from "vitest";

import { BadRequestException } from "@/utils/exceptions";

import { bookingTerms, type TermsService } from "./terms";

// Real now 2026-10-01T09:00Z = 10:00 Lagos wall-clock.
const NOW = new Date("2026-10-01T09:00:00.000Z");
const at = (iso: string) => new Date(iso);

const SLOT: TermsService = {
  bookingMode: "SLOT", price: 25000, duration: 240,
  checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 30,
};
const STAY: TermsService = {
  bookingMode: "NIGHTLY", price: 85000, duration: 1440,
  checkInTime: "14:00", checkOutTime: "12:00", minUnits: 2, maxUnits: 30,
};
const CAR: TermsService = {
  bookingMode: "DAILY", price: 70000, duration: 1440,
  checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 14,
};

describe("bookingTerms: SLOT", () => {
  it("ends after the duration and costs the price", () => {
    const terms = bookingTerms(SLOT, at("2026-10-02T13:00:00.000Z"), 5, { now: NOW });
    expect(terms.endTime).toEqual(at("2026-10-02T17:00:00.000Z"));
    expect(terms.units).toBe(1);
    expect(terms.amount.toString()).toBe("25000");
  });
  it("rejects a slot that started earlier today in Lagos", () => {
    // 09:30 wall-clock is before 10:00 Lagos now, though after 09:00 real UTC.
    expect(() => bookingTerms(SLOT, at("2026-10-01T09:30:00.000Z"), 1, { now: NOW })).toThrow(BadRequestException);
  });
  it("rejects invalid date", () => {
    expect(() => bookingTerms(SLOT, new Date("invalid"), 1, { now: NOW })).toThrow(new BadRequestException("Invalid booking start time."));
  });
});

describe("bookingTerms: NIGHTLY", () => {
  it("checks out on the last morning and charges per night", () => {
    const terms = bookingTerms(STAY, at("2026-10-02T14:00:00.000Z"), 3, { now: NOW });
    expect(terms.endTime).toEqual(at("2026-10-05T12:00:00.000Z"));
    expect(terms.units).toBe(3);
    expect(terms.amount.toString()).toBe("255000");
  });
  it("accepts a check-in tonight even after the check-in hour", () => {
    const evening = new Date("2026-10-01T17:00:00.000Z"); // 18:00 Lagos
    expect(() => bookingTerms(STAY, at("2026-10-01T14:00:00.000Z"), 2, { now: evening })).not.toThrow();
  });
  it("rejects yesterday", () => {
    expect(() => bookingTerms(STAY, at("2026-09-30T14:00:00.000Z"), 2, { now: NOW })).toThrow("That check-in date has passed");
  });
  it("rejects a start that isn't the check-in time", () => {
    expect(() => bookingTerms(STAY, at("2026-10-02T10:00:00.000Z"), 2, { now: NOW })).toThrow("Check-in is from 14:00.");
  });
  it("enforces min and max nights", () => {
    expect(() => bookingTerms(STAY, at("2026-10-02T14:00:00.000Z"), 1, { now: NOW })).toThrow("Book between 2 and 30 nights.");
    expect(() => bookingTerms(STAY, at("2026-10-02T14:00:00.000Z"), 31, { now: NOW })).toThrow(BadRequestException);
  });
  it("can skip unit limits for an owner moving an existing stay", () => {
    expect(() =>
      bookingTerms(STAY, at("2026-10-02T14:00:00.000Z"), 1, { now: NOW, enforceUnitLimits: false }),
    ).not.toThrow();
  });
  it("refuses a stay without check-in and check-out times", () => {
    expect(() =>
      bookingTerms({ ...STAY, checkInTime: null }, at("2026-10-02T14:00:00.000Z"), 2, { now: NOW }),
    ).toThrow(BadRequestException);
  });
});

describe("bookingTerms: DAILY", () => {
  it("returns 24 hours per day and charges per day", () => {
    const terms = bookingTerms(CAR, at("2026-10-05T10:00:00.000Z"), 2, { now: NOW });
    expect(terms.endTime).toEqual(at("2026-10-07T10:00:00.000Z"));
    expect(terms.amount.toString()).toBe("140000");
  });
  it("only picks up on the hour", () => {
    expect(() => bookingTerms(CAR, at("2026-10-05T10:30:00.000Z"), 2, { now: NOW })).toThrow("Pickup times are on the hour.");
  });
  it("rejects a pickup time that has passed", () => {
    expect(() => bookingTerms(CAR, at("2026-10-01T09:00:00.000Z"), 1, { now: NOW })).toThrow(BadRequestException);
  });
});

describe("bookingTerms: horizon", () => {
  it("rejects starts more than 180 days ahead", () => {
    expect(() => bookingTerms(CAR, at("2027-04-01T10:00:00.000Z"), 1, { now: NOW })).toThrow(
      "Bookings open up to 180 days ahead.",
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  addMonths,
  bookingSpan,
  bookingWhen,
  daysBetween,
  eachDate,
  formatMonth,
  monthStart,
  nightsWindow,
  serviceLabel,
  todayEventLabel,
  unitCount,
} from "./format";

describe("unit wording", () => {
  it("counts nights and days", () => {
    expect(unitCount("NIGHTLY", 1)).toBe("1 night");
    expect(unitCount("NIGHTLY", 3)).toBe("3 nights");
    expect(unitCount("DAILY", 2)).toBe("2 days");
  });
});

describe("serviceLabel", () => {
  const base = { name: "Lekki 2-bed, Unit 4B", price: "85000", duration: 1440, currency: "NGN" };
  it("keeps the slot label", () => {
    expect(serviceLabel({ name: "Knotless braids", price: 25000, duration: 240, currency: "NGN" })).toBe(
      "Knotless braids — NGN 25,000 (4 hr)",
    );
  });
  it("prices stays per night and rentals per day", () => {
    expect(serviceLabel({ ...base, bookingMode: "NIGHTLY" })).toBe("Lekki 2-bed, Unit 4B — NGN 85,000 / night");
    expect(serviceLabel({ ...base, name: "Toyota Prado", price: 70000, bookingMode: "DAILY" })).toBe(
      "Toyota Prado — NGN 70,000 / day",
    );
  });
});

describe("bookingWhen and bookingSpan", () => {
  const stay = {
    bookingMode: "NIGHTLY" as const,
    startTime: "2026-10-02T14:00:00.000Z",
    endTime: "2026-10-05T12:00:00.000Z",
    units: 3,
  };
  const rental = {
    bookingMode: "DAILY" as const,
    startTime: "2026-09-28T10:00:00.000Z",
    endTime: "2026-09-30T10:00:00.000Z",
    units: 2,
  };
  const slot = {
    bookingMode: "SLOT" as const,
    startTime: "2026-09-28T13:00:00.000Z",
    endTime: "2026-09-28T17:00:00.000Z",
    units: 1,
  };

  it("describes a stay", () => {
    expect(bookingWhen(stay)).toBe("Check-in Fri 2 Oct from 14:00 · Check-out Mon 5 Oct by 12:00 · 3 nights");
    expect(bookingSpan(stay)).toBe("2–5 Oct · 3 nights");
  });
  it("describes a rental", () => {
    expect(bookingWhen(rental)).toBe("Pickup Mon 28 Sep, 10:00 · Return Wed 30 Sep, 10:00 · 2 days");
    expect(bookingSpan(rental)).toBe("28–30 Sep · 2 days");
  });
  it("spans months", () => {
    expect(bookingSpan({ ...stay, startTime: "2026-09-30T14:00:00.000Z", endTime: "2026-10-02T12:00:00.000Z", units: 2 })).toBe(
      "30 Sep–2 Oct · 2 nights",
    );
  });
  it("keeps the slot wording", () => {
    expect(bookingWhen(slot)).toBe("Mon 28 Sep at 13:00");
    expect(bookingSpan(slot)).toBe("Mon 28 Sep at 13:00");
  });
});

describe("today's event labels", () => {
  it("names each kind", () => {
    expect(todayEventLabel("CHECK_IN")).toBe("Check-in");
    expect(todayEventLabel("CHECK_OUT")).toBe("Check-out");
    expect(todayEventLabel("PICKUP")).toBe("Pickup");
    expect(todayEventLabel("RETURN")).toBe("Return");
    expect(todayEventLabel("SLOT")).toBe("");
  });
});

describe("calendar dates", () => {
  it("lists dates in a half-open range", () => {
    expect(eachDate("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(daysBetween("2026-09-29", "2026-10-02")).toBe(3);
  });
  it("works with months", () => {
    expect(monthStart("2026-10-17")).toBe("2026-10-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-10-01", -1)).toBe("2026-09-01");
    expect(formatMonth("2026-10-01")).toBe("October 2026");
  });
  it("sizes the nights window to fit the longest stay", () => {
    expect(nightsWindow("2026-10-01", 30)).toEqual({ from: "2026-10-01", to: "2026-12-01" });
  });
});

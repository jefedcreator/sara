import { describe, expect, it } from "vitest";

import { bookingSetupProblem } from "./service.validator";

describe("bookingSetupProblem", () => {
  it("accepts a slot service", () => {
    expect(bookingSetupProblem({ bookingMode: "SLOT", minUnits: 1, maxUnits: 30 })).toBeNull();
  });
  it("needs check-in and check-out times for a stay", () => {
    expect(bookingSetupProblem({ bookingMode: "NIGHTLY", checkInTime: "14:00", minUnits: 1, maxUnits: 30 })).toMatch(/required/);
  });
  it("needs check-out no later than check-in", () => {
    expect(
      bookingSetupProblem({ bookingMode: "NIGHTLY", checkInTime: "12:00", checkOutTime: "14:00", minUnits: 1, maxUnits: 30 }),
    ).toMatch(/no later than/);
    expect(
      bookingSetupProblem({ bookingMode: "NIGHTLY", checkInTime: "14:00", checkOutTime: "12:00", minUnits: 1, maxUnits: 30 }),
    ).toBeNull();
  });
  it("needs min no more than max", () => {
    expect(bookingSetupProblem({ bookingMode: "DAILY", minUnits: 5, maxUnits: 3 })).toMatch(/minUnits/);
  });
});

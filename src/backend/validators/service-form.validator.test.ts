import { describe, expect, it } from "vitest";

import { serviceFormSchema } from "./service-form.validator";

const base = {
  name: "Lekki 2-bed, Unit 4B",
  price: "85,000",
  duration: "",
  availableFrom: "08:00",
  availableTo: "18:00",
  checkInTime: "14:00",
  checkOutTime: "12:00",
  minUnits: "2",
  maxUnits: "30",
  description: "",
};

describe("serviceFormSchema", () => {
  it("turns a nightly form into a stay service", () => {
    const out = serviceFormSchema.parse({ ...base, bookingMode: "NIGHTLY" });
    expect(out).toMatchObject({
      bookingMode: "NIGHTLY", price: 85000, duration: 1440,
      checkInTime: "14:00", checkOutTime: "12:00", minUnits: 2, maxUnits: 30,
    });
  });
  it("needs a duration only for slot services", () => {
    expect(serviceFormSchema.safeParse({ ...base, bookingMode: "SLOT" }).success).toBe(false);
    const slot = serviceFormSchema.parse({ ...base, bookingMode: "SLOT", duration: "240" });
    expect(slot).toMatchObject({ duration: 240, minUnits: 1, maxUnits: 1 });
    expect(slot.checkInTime).toBeUndefined();
  });
  it("rejects a check-out later than check-in", () => {
    const result = serviceFormSchema.safeParse({ ...base, bookingMode: "NIGHTLY", checkOutTime: "15:00" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["checkOutTime"]);
  });
  it("rejects a minimum above the maximum", () => {
    const result = serviceFormSchema.safeParse({ ...base, bookingMode: "DAILY", minUnits: "5", maxUnits: "3" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["maxUnits"]);
  });
});

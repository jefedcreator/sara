import { describe, expect, it } from "vitest";
import { formatMoney, parseAmount } from "./amount";

describe("parseAmount", () => {
  it("parses plain digits", () => expect(parseAmount("5000")).toBe(5000));
  it("ignores commas and currency symbols", () => expect(parseAmount("₦15,000")).toBe(15000));
  it("expands a trailing k as thousands", () => expect(parseAmount("15k")).toBe(15000));
  it("returns null for non-numeric input", () => expect(parseAmount("abc")).toBeNull());
  it("returns null for zero or negative", () => {
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-100")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats with separators and currency", () =>
    expect(formatMoney(15000, "NGN")).toBe("NGN 15,000"));
});

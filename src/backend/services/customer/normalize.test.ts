import { describe, expect, it } from "vitest";

import { nameKey, normalizeEmail, normalizePhone } from "./normalize";

describe("normalizePhone", () => {
  it.each([
    "0803 555 0142",
    "+234 803 555 0142",
    "2348035550142",
    "08035550142",
    "8035550142",
    "+234-803-555-0142",
  ])("normalises %s to +2348035550142", (raw) => {
    expect(normalizePhone(raw)).toBe("+2348035550142");
  });

  it("keeps a foreign number written with + or 00", () => {
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("0044 7700 900123")).toBe("+447700900123");
  });

  it.each(["", "12", "abc", null, undefined])(
    "returns null for %s",
    (raw) => {
      expect(normalizePhone(raw)).toBeNull();
    },
  );

  it("keeps an international number with 8 to 15 digits", () => {
    expect(normalizePhone("+12345678")).toBe("+12345678");
    expect(normalizePhone("+123456789012345")).toBe("+123456789012345");
  });

  it("rejects an international number outside 8 to 15 digits", () => {
    expect(normalizePhone("+1234567")).toBeNull();
    expect(normalizePhone("+1234567890123456")).toBeNull();
  });

  it("turns a 10-digit local number into a Nigerian number", () => {
    expect(normalizePhone("1234567890")).toBe("+2341234567890");
  });

  it("rejects a number that fits none of the rules", () => {
    expect(normalizePhone("234803555014")).toBeNull();
    expect(normalizePhone("023456789012")).toBeNull();
  });

  it("ignores punctuation around the number", () => {
    expect(normalizePhone(" (0803) 555-0142 ")).toBe("+2348035550142");
  });
});

describe("normalizeEmail", () => {
  it("lower-cases and trims email", () => {
    expect(normalizeEmail(" Tolu@Example.COM ")).toBe("tolu@example.com");
  });

  it("rejects a malformed email", () => {
    expect(normalizeEmail("tolu@")).toBeNull();
    expect(normalizeEmail("tolu.example.com")).toBeNull();
    expect(normalizeEmail("tolu @example.com")).toBeNull();
  });

  it.each(["", "   ", null, undefined])("returns null for %s", (raw) => {
    expect(normalizeEmail(raw)).toBeNull();
  });
});

describe("nameKey", () => {
  it("keys names without case or extra spaces", () => {
    expect(nameKey("  Tolu   Adeyemi ")).toBe("tolu adeyemi");
  });
});

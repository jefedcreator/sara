import { describe, expect, it } from "vitest";

import { parseEnglishAmount, verifyOwnerPrice } from "./amount";
import type { OwnerEvidence } from "./types";

describe("parseEnglishAmount", () => {
  it("parses spoken Nigerian amounts deterministically", () => {
    expect(parseEnglishAmount("forty-five thousand")).toBe(4_500_000);
    expect(parseEnglishAmount("45k")).toBe(4_500_000);
    expect(parseEnglishAmount("45,000.50")).toBe(4_500_050);
  });

  it("parses large spoken amounts", () => {
    expect(parseEnglishAmount("one hundred and twenty-five thousand")).toBe(
      12_500_000,
    );
    expect(parseEnglishAmount("two million")).toBe(200_000_000);
    expect(parseEnglishAmount("ten thousand five hundred naira")).toBe(
      1_050_000,
    );
  });

  it("parses various digit, k-notation and currency prefix/suffix variants", () => {
    expect(parseEnglishAmount("₦45,000")).toBe(4_500_000);
    expect(parseEnglishAmount("₦ 45,000")).toBe(4_500_000);
    expect(parseEnglishAmount("45000 naira")).toBe(4_500_000);
    expect(parseEnglishAmount("₦ 45k")).toBe(4_500_000);
    expect(parseEnglishAmount("NGN 45,000")).toBe(4_500_000);
    expect(parseEnglishAmount("45.5k")).toBe(4_550_000);
    expect(parseEnglishAmount("1.5k")).toBe(150_000);
    expect(parseEnglishAmount("100.25")).toBe(10_025);
  });

  it("handles zero and fractional currency properly", () => {
    expect(parseEnglishAmount("0")).toBe(0);
    expect(parseEnglishAmount("0.00")).toBe(0);
    expect(parseEnglishAmount("zero")).toBe(0);
    expect(parseEnglishAmount("zero naira")).toBe(0);
    expect(parseEnglishAmount("0.50")).toBe(50);
    expect(parseEnglishAmount("0.5")).toBe(50);
    expect(parseEnglishAmount("0.05")).toBe(5);
  });

  it("rejects more than two decimal places", () => {
    expect(parseEnglishAmount("45,000.555")).toBeNull();
    expect(parseEnglishAmount("10.123")).toBeNull();
    expect(parseEnglishAmount("0.001")).toBeNull();
  });

  it("rejects negative amounts", () => {
    expect(parseEnglishAmount("-45000")).toBeNull();
    expect(parseEnglishAmount("-10.50")).toBeNull();
    expect(parseEnglishAmount("minus fifty")).toBeNull();
    expect(parseEnglishAmount("negative ten")).toBeNull();
  });

  it("rejects loose sentences and unrecognized tokens", () => {
    expect(parseEnglishAmount("Invoice Tolu for two wigs")).toBeNull();
    expect(parseEnglishAmount("hello")).toBeNull();
    expect(parseEnglishAmount("two million dollars and cats")).toBeNull();
    expect(parseEnglishAmount("")).toBeNull();
    expect(parseEnglishAmount("   ")).toBeNull();
    expect(parseEnglishAmount("naira")).toBeNull();
    expect(parseEnglishAmount("₦")).toBeNull();
  });

  it("rejects nonfinite or unsafe numbers", () => {
    expect(parseEnglishAmount("Infinity")).toBeNull();
    expect(parseEnglishAmount("NaN")).toBeNull();
    expect(parseEnglishAmount("999999999999999999999999999")).toBeNull();
  });
});

describe("verifyOwnerPrice", () => {
  const dummyEvidence: OwnerEvidence = {
    text: "Please invoice Tolu 45,000 for wig",
    recentOwnerTexts: ["Earlier I mentioned forty-five thousand"],
    selectedIds: [],
  };

  it("requires a real owner quote for a price override", () => {
    expect(() =>
      verifyOwnerPrice(
        { quote: "forty-five thousand", amountMinor: 4_500_000 },
        {
          text: "Invoice Tolu for two wigs",
          recentOwnerTexts: [],
          selectedIds: [],
        },
      ),
    ).toThrow("price");
  });

  it("succeeds when quote matches evidence.text", () => {
    const verified = verifyOwnerPrice(
      { quote: "45,000", amountMinor: 4_500_000 },
      dummyEvidence,
    );
    expect(verified).toBe(4_500_000);
  });

  it("succeeds when quote matches recentOwnerTexts case-insensitively", () => {
    const verified = verifyOwnerPrice(
      { quote: "forty-five thousand", amountMinor: 4_500_000 },
      dummyEvidence,
    );
    expect(verified).toBe(4_500_000);
  });

  it("throws when amountMinor does not match the quote amount", () => {
    expect(() =>
      verifyOwnerPrice(
        { quote: "45,000", amountMinor: 5_000_000 },
        dummyEvidence,
      ),
    ).toThrow("Please state the price you want to use.");
  });
});

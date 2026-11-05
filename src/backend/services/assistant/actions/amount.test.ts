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
    recentOwnerTexts: ["Earlier I mentioned the price of forty-five thousand"],
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

describe("positive monetary evidence", () => {
  it.each([
    ["1234", 123_400, "Invoice Tolu for two bottles, product code 1234"],
    ["1234", 123_400, "Invoice Tolu for two bottles product code 1234"],
    ["1234", 123_400, "Invoice number 1234"],
    ["1234", 123_400, "Receipt reference 1234"],
    ["1234", 123_400, "Record payment, confirmation reference 1234"],
    ["1234", 123_400, "Invoice Tolu, phone number 1234"],
    ["2026", 202_600, "Invoice Tolu, delivery date 2026"],
    ["1234", 123_400, "Invoice Tolu, quantity 1234"],
    ["1234", 123_400, "Use code 1234"],
    ["1234", 123_400, "Product code at 1234"],
    ["1234", 123_400, "Phone at 1234"],
    ["1234", 123_400, "Use 1234 as product code"],
    ["1234", 123_400, "Use 1234 for invoice number"],
    ["1234", 123_400, "Use 1234 for SKU"],
    ["1234", 123_400, "Use 1234 for reference value"],
    ["1234", 123_400, "Product code; use 1234"],
    ["1234", 123_400, "Invoice Tolu; record 1234"],
    ["1234", 123_400, "Price code 1234"],
    ["1234", 123_400, "Set the price to 45000; reference 1234"],
    ["#1234", 123_400, "Invoice #1234"],
    ["1234", 123_400, "Invoice #1234"],
    ["#1234", 123_400, "Order #1234"],
    ["#1234", 123_400, "Product #1234"],
    ["#1234", 123_400, "Product reference #1234"],
    ["#1234", 123_400, "Use #1234"],
    ["NGN1234", 123_400, "Product code NGN1234"],
  ])("does not promote a labelled reference to a price: %s", (quote, minor, text) => {
    expect(() => verifyOwnerPrice({ quote: String(quote), amountMinor: Number(minor) }, { text: String(text), recentOwnerTexts: [], selectedIds: [] })).toThrow("price");
  });

  it.each(["bottles", "packs", "cartons", "bundles", "appointments", "people", "widgets", "unlisted-things"])("does not interpret an item count before %s as a price", (noun) => {
    const evidence = { text: `Invoice Amaka for two ${noun} shea butter`, recentOwnerTexts: [], selectedIds: [] };
    expect(() => verifyOwnerPrice({ quote: "two", amountMinor: 200 }, evidence)).toThrow("Please state the price");
  });

  it.each([
    ["two", 200, "Use two bottles at 45,000 each"],
    ["two", 200, "Set the price for two packs"],
    ["two thousand", 200_000, "Invoice Amaka for two thousand bottles"],
    ["45000", 4_500_000, "Use 45000 bottles"],
    ["two", 200, "two"],
    ["two", 200, "Use two"],
    ["two", 200, "Record two"],
  ])("requires positive monetary context for %s", (quote, minor, text) => {
    expect(() => verifyOwnerPrice({ quote: String(quote), amountMinor: Number(minor) }, { text: String(text), recentOwnerTexts: ["The price is 45,000"], selectedIds: [] })).toThrow("price");
  });

  it.each([
    ["forty-five thousand", 4_500_000, "forty-five thousand each"],
    ["NGN45000", 4_500_000, "Use NGN45000"],
    ["45,000", 4_500_000, "Set the price to 45,000"],
    ["45000", 4_500_000, "Use 45000"],
    ["10000", 1_000_000, "Payment 10000 cash"],
    ["45000", 4_500_000, "Record 45000"],
    ["two", 200, "The price is two"],
    ["two naira", 200, "Charge two naira"],
    ["forty-five thousand", 4_500_000, "Invoice Amaka for two bottles at forty-five thousand each"],
    ["45000", 4_500_000, "Use 45000 for two packs"],
    ["45,000", 4_500_000, "Invoice Tolu 45,000 for wig"],
    ["45,000", 4_500_000, "Invoice Tolu for a wig at 45,000"],
    ["5,000", 500_000, "Invoice Tolu for a wig at 45,000 and installation at 5,000"],
    ["#45,000", 4_500_000, "The price is #45,000"],
    ["₦45,000", 4_500_000, "Use ₦45,000"],
    ["45,000 naira", 4_500_000, "Use 45,000 naira"],
    ["45000", 4_500_000, "Product code 1234; the price is 45000"],
  ])("accepts an explicitly requested monetary value: %s", (quote, minor, text) => {
    expect(verifyOwnerPrice({ quote: String(quote), amountMinor: Number(minor) }, { text: String(text), recentOwnerTexts: [], selectedIds: [] })).toBe(minor);
  });

  it("accepts a standalone monetary correction only with stored pricing context", () => {
    const value = { quote: "45000", amountMinor: 4_500_000 };
    expect(verifyOwnerPrice(value, { text: "45000", recentOwnerTexts: ["Set the price to 40,000"], selectedIds: [] })).toBe(value.amountMinor);
    expect(verifyOwnerPrice({ quote: "two", amountMinor: 200 }, { text: "Actually two", recentOwnerTexts: ["The price is three naira"], selectedIds: [] })).toBe(200);
    expect(() => verifyOwnerPrice(value, { text: "45000", recentOwnerTexts: ["Invoice Amaka for two bottles"], selectedIds: [] })).toThrow("price");
    expect(() => verifyOwnerPrice(value, { text: "45000", recentOwnerTexts: [], selectedIds: [] })).toThrow("price");
    expect(() => verifyOwnerPrice(value, { text: "45000", recentOwnerTexts: ["The price code is 1234"], selectedIds: [] })).toThrow("price");
    // A later price-setting instruction must not promote an old quantity reply.
    expect(() => verifyOwnerPrice({ quote: "two", amountMinor: 200 }, { text: "Set the price to 45,000", recentOwnerTexts: ["two"], selectedIds: [] })).toThrow("price");
  });

  it.each([
    "Charge 45000", "Pay 45000", "Paid 45000", "Charging 45000",
    "Charge45000", "Pay45000", "Paid45000", "Paid NGN45000",
    "Charge forty-five thousand", "Paid ₦45,000", "The price is three naira",
    "Payment 45,000 cash", "The price is #45,000",
  ])("retains corrections after an attached monetary verb statement: %s", (priorTurn) => {
    expect(verifyOwnerPrice({ quote: "40000", amountMinor: 4_000_000 }, {
      text: "Actually 40000", recentOwnerTexts: [priorTurn], selectedIds: [],
    })).toBe(4_000_000);
  });

  it.each([
    "Charge product code 1234", "Paid invoice number 1234", "Pay phone 1234",
    "Charge reference #1234", "Product code 1234; charge", "The price code is 1234",
  ])("does not infer correction context from an unattached monetary verb: %s", (priorTurn) => {
    expect(() => verifyOwnerPrice({ quote: "40000", amountMinor: 4_000_000 }, {
      text: "Actually 40000", recentOwnerTexts: [priorTurn], selectedIds: [],
    })).toThrow("price");
  });

  it.each([
    "Charge three bottles to Tolu", "Pay two thousand widgets",
    "Charge 45000 bottles", "The price of two packs",
    "Charge three and four", "Paid 45000.555",
    "Charge product code 1234", "Paid invoice number 1234",
    "Pay phone 1234", "Charge reference #1234",
  ])("does not use a quantity, malformed amount, or labelled ID as prior pricing: %s", (priorTurn) => {
    expect(() => verifyOwnerPrice({ quote: "two", amountMinor: 200 }, {
      text: "Actually two", recentOwnerTexts: [priorTurn], selectedIds: [],
    })).toThrow("price");
  });
});

describe("whole amount evidence", () => {
  it.each(["and", "one one", "twenty thirty", "one thousand and", "million", "one thousand million", "12,34", "1.234k", "two hundred hundred", "one point five five five"])("rejects malformed amount grammar: %s", (value) => {
    expect(parseEnglishAmount(value)).toBeNull();
  });

  it.each([
    ["one point five zero", 150],
    ["zero point zero five", 5],
    ["125 thousand", 12_500_000],
    ["one million two hundred and fifty thousand", 125_000_000],
  ])("parses complete currency expression %s", (value, minor) => {
    expect(parseEnglishAmount(String(value))).toBe(minor);
  });

  it.each([
    ["two", 200, "Invoice Tolu for two wigs"],
    ["5", 500, "Set the price to 45,000"],
    ["45", 4500, "Set the price to 45,000"],
    ["five thousand", 500000, "Use forty-five thousand"],
    ["500", 50000, "Phone 08035550000"],
    ["45,000", 4500000, "Use -45,000"],
    ["five", 500, "Use forty five thousand"],
    ["forty five", 4500, "Use forty five thousand"],
    ["45", 4500, "Use 45 thousand"],
    ["45,000", 4500000, "Use minus 45,000"],
    ["45,000", 4500000, "Use negative 45,000"],
    ["45,000", 4500000, "Use - 45,000"],
    ["five", 500, "Use five point five"],
    ["five", 500, "Use five point zero"],
    ["five", 500, "Use one hundred and five"],
  ])("cannot take %s out of another amount or token", (quote, minor, text) => {
    expect(() => verifyOwnerPrice({ quote: String(quote), amountMinor: Number(minor) }, { text: String(text), recentOwnerTexts: [], selectedIds: [] })).toThrow("price");
  });

  it.each([
    ["45,000", 4_500_000, "Use NGN 45,000."],
    ["45,000", 4_500_000, "Use 45,000 naira and installation at 5,000"],
    ["forty five thousand", 4_500_000, "Use forty five thousand"],
    ["five point five", 550, "Use five point five naira"],
  ])("accepts complete amount %s with currency or sentence punctuation", (quote, minor, text) => {
    expect(verifyOwnerPrice({ quote: String(quote), amountMinor: Number(minor) }, { text: String(text), recentOwnerTexts: [], selectedIds: [] })).toBe(minor);
  });
});

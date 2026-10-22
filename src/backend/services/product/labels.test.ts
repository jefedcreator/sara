import { describe, expect, it } from "vitest";

import { optionLabel } from "./labels";

describe("optionLabel", () => {
  it("joins the product and option names with an em dash", () => {
    expect(optionLabel("Frontal wig", '20"')).toBe('Frontal wig — 20"');
  });

  it("shows only the product name when the option is unnamed", () => {
    expect(optionLabel("Shea butter 250ml", "")).toBe("Shea butter 250ml");
  });

  it("ignores whitespace in an option name", () => {
    expect(optionLabel("Shea butter 250ml", "  ")).toBe("Shea butter 250ml");
  });
});

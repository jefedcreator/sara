import { describe, expect, it } from "vitest";

import {
  productValidatorSchema,
  stockAdjustValidatorSchema,
  updateProductValidatorSchema,
} from "./product.validator";

const FORM = {
  name: "Frontal wig",
  description: "Hand-tied frontal unit",
  price: "45000",
  tracksStock: "true",
};

describe("productValidatorSchema", () => {
  it("parses options from a JSON string", () => {
    const result = productValidatorSchema.safeParse({
      ...FORM,
      options: JSON.stringify([
        { name: '20"', stock: "6" },
        { name: '22"', price: "48000", stock: 2 },
      ]),
    });

    expect(result.success).toBe(true);
    expect(result.data?.options[0]?.name).toBe('20"');
    expect(result.data?.options[0]?.stock).toBe(6);
    expect(result.data?.options[1]).toMatchObject({
      name: '22"',
      price: 48000,
      stock: 2,
    });
    expect(result.data?.price).toBe(45000);
    expect(result.data?.tracksStock).toBe(true);
  });

  it("accepts an already-parsed options array", () => {
    const result = productValidatorSchema.safeParse({
      ...FORM,
      options: [{ name: "Shea butter 250ml", stock: 0 }],
    });

    expect(result.success).toBe(true);
    expect(result.data?.options).toEqual([
      { name: "Shea butter 250ml", stock: 0 },
    ]);
  });

  it("rejects options that aren't valid JSON", () => {
    const result = productValidatorSchema.safeParse({
      ...FORM,
      options: "not json",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("options must be valid JSON");
  });

  it("rejects options JSON that isn't an array", () => {
    const result = productValidatorSchema.safeParse({
      ...FORM,
      options: JSON.stringify({ name: '20"', stock: 6 }),
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "options must be a JSON array",
    );
  });

  it('reads tracksStock from "false" as false and defaults it to true', () => {
    const off = productValidatorSchema.safeParse({
      ...FORM,
      tracksStock: "false",
      options: [{ name: "", stock: 0 }],
    });
    const missing = productValidatorSchema.safeParse({
      name: "Frontal wig",
      price: 45000,
      options: [{ name: "", stock: 0 }],
    });

    expect(off.success).toBe(true);
    expect(off.data?.tracksStock).toBe(false);
    expect(missing.success).toBe(true);
    expect(missing.data?.tracksStock).toBe(true);
  });

  it("rejects a negative price and a negative stock", () => {
    const price = productValidatorSchema.safeParse({
      ...FORM,
      price: "-1",
      options: [{ name: "", stock: 0 }],
    });
    const stock = productValidatorSchema.safeParse({
      ...FORM,
      options: [{ name: "", stock: -1 }],
    });

    expect(price.success).toBe(false);
    expect(stock.success).toBe(false);
  });
});

describe("updateProductValidatorSchema", () => {
  it("parses keepPhotos as JSON and isActive as a form boolean", () => {
    const result = updateProductValidatorSchema.safeParse({
      keepPhotos: JSON.stringify(["https://cdn.test/1.jpg"]),
      isActive: "false",
    });

    expect(result.success).toBe(true);
    expect(result.data?.keepPhotos).toEqual(["https://cdn.test/1.jpg"]);
    expect(result.data?.isActive).toBe(false);
  });
});

describe("stockAdjustValidatorSchema", () => {
  it("needs exactly one of add or set", () => {
    const add = stockAdjustValidatorSchema.safeParse({
      optionId: "opt_1",
      add: 5,
    });
    const set = stockAdjustValidatorSchema.safeParse({
      optionId: "opt_1",
      set: 2,
    });
    const both = stockAdjustValidatorSchema.safeParse({
      optionId: "opt_1",
      add: 5,
      set: 2,
    });
    const neither = stockAdjustValidatorSchema.safeParse({
      optionId: "opt_1",
    });

    expect(add.success).toBe(true);
    expect(set.success).toBe(true);
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]?.message).toBe(
      "Choose either add or set, not both",
    );
    expect(neither.success).toBe(false);
    expect(neither.error?.issues[0]?.message).toBe("Choose either add or set");
  });

  it("rejects an add of 0 and a negative set", () => {
    const zero = stockAdjustValidatorSchema.safeParse({
      optionId: "opt_1",
      add: 0,
    });
    const negative = stockAdjustValidatorSchema.safeParse({
      optionId: "opt_1",
      set: -1,
    });

    expect(zero.success).toBe(false);
    expect(zero.error?.issues[0]?.message).toBe("add cannot be 0");
    expect(negative.success).toBe(false);
  });

  it("allows a negative add and requires whole numbers", () => {
    const negativeAdd = stockAdjustValidatorSchema.safeParse({
      optionId: "opt_1",
      add: -3,
    });
    const fractional = stockAdjustValidatorSchema.safeParse({
      optionId: "opt_1",
      add: 1.5,
    });

    expect(negativeAdd.success).toBe(true);
    expect(fractional.success).toBe(false);
    expect(fractional.error?.issues[0]?.message).toBe(
      "add must be a whole number",
    );
  });
});

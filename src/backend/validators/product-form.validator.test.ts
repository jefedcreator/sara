import { describe, expect, it } from "vitest";

import { productFormSchema } from "./product-form.validator";

const base = {
  name: "Frontal wig",
  price: "45,000",
  description: "",
  tracksStock: true,
  options: [{ name: "", price: "", stock: "11" }],
};

describe("productFormSchema", () => {
  it("turns “45,000” into 45000", () => {
    const out = productFormSchema.parse(base);
    expect(out.price).toBe(45000);
  });

  it("needs a stock number for each option when stock is tracked", () => {
    const result = productFormSchema.safeParse({
      ...base,
      options: [{ name: "", price: "", stock: "" }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Enter how many you have");
  });

  it("accepts an option that uses the product's price", () => {
    const out = productFormSchema.parse({
      ...base,
      options: [{ name: "20 inch", price: "", stock: "11" }],
    });
    expect(out.options[0]).toMatchObject({ name: "20 inch", price: null, stock: 11 });
  });

  it("rejects two options with the same name, ignoring case", () => {
    const result = productFormSchema.safeParse({
      ...base,
      options: [
        { name: "Red", price: "", stock: "4" },
        { name: "red", price: "", stock: "2" },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Each option needs a different name");
  });

  it("names options once there is more than one", () => {
    const result = productFormSchema.safeParse({
      ...base,
      options: [
        { name: "", price: "", stock: "4" },
        { name: "Red", price: "", stock: "2" },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["options", 0, "name"]);
  });

  it("sets stock to zero when the product is made to order", () => {
    const out = productFormSchema.parse({
      ...base,
      tracksStock: false,
      options: [{ name: "", price: "", stock: "" }],
    });
    expect(out.options[0]?.stock).toBe(0);
  });
});

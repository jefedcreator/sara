import { describe, expect, it } from "vitest";
import type { ProductDto } from "types";

import { lineStockWarning, stockWarning } from "./use-document-composer";

function product(overrides: Partial<ProductDto> = {}): ProductDto {
  return {
    id: "prod_1",
    slug: "shea-butter",
    businessId: "biz_1",
    name: "Shea butter 250ml",
    description: null,
    price: "6500",
    photos: [],
    tracksStock: true,
    isActive: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    options: [
      { id: "opt_1", productId: "prod_1", name: "", price: null, stock: 9, position: 0, isActive: true },
    ],
    ...overrides,
  };
}

describe("stockWarning", () => {
  it("warns when a receipt sells more than is in stock", () => {
    expect(
      stockWarning([{ productOptionId: "opt_1", quantity: "10" }], [product()]),
    ).toBe("Only 9 Shea butter 250ml in stock");
  });

  it("is quiet when the sale fits, for services and for made-to-order products", () => {
    expect(stockWarning([{ productOptionId: "opt_1", quantity: "9" }], [product()])).toBeNull();
    expect(stockWarning([{ quantity: "50" }], [product()])).toBeNull();
    expect(
      stockWarning([{ productOptionId: "opt_1", quantity: "50" }], [product({ tracksStock: false })]),
    ).toBeNull();
  });

  it("adds up lines for the same option and names the option", () => {
    const wig = product({
      name: "Frontal wig",
      options: [
        { id: "opt_2", productId: "prod_1", name: '20"', price: "45000", stock: 3, position: 0, isActive: true },
      ],
    });
    expect(
      stockWarning(
        [
          { productOptionId: "opt_2", quantity: "2" },
          { productOptionId: "opt_2", quantity: "2" },
        ],
        [wig],
      ),
    ).toBe('Only 3 Frontal wig — 20" in stock');
  });

  it("says sold out when nothing is left", () => {
    const soldOut = product({
      options: [
        { id: "opt_1", productId: "prod_1", name: "", price: null, stock: 0, position: 0, isActive: true },
      ],
    });
    expect(lineStockWarning({ productOptionId: "opt_1", quantity: "1" }, [soldOut])).toBe(
      "Shea butter 250ml is sold out",
    );
  });
});

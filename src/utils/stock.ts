/*
 * Stock words for products. Pure, client-safe: the owner's product cards and
 * (from Task 16) the customer's product page read the same labels.
 */

/** Three or fewer left is worth mentioning. */
export const LOW_STOCK = 3;

export type StockTone = "ok" | "low" | "out" | "untracked";

export type StockBadge = {
  label: string;
  tone: StockTone;
};

/**
 * "11 in stock", "3 left", "Sold out", or "Made to order" when the product
 * doesn't track stock. Stock never goes below zero, but treat a stray
 * negative as sold out rather than printing it.
 */
export function stockBadge(tracksStock: boolean, stock: number): StockBadge {
  if (!tracksStock) return { label: "Made to order", tone: "untracked" };
  if (stock <= 0) return { label: "Sold out", tone: "out" };
  if (stock <= LOW_STOCK) return { label: `${stock} left`, tone: "low" };
  return { label: `${stock} in stock`, tone: "ok" };
}

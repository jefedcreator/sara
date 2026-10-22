import type { Metadata } from "next";

import { formatMoney } from "@/utils/format";
import { linkNotFoundMetadata, pageMetadata } from "@/utils/metadata";
import { LOW_STOCK } from "@/utils/stock";

/*
 * A product as its public page (/products/<slug>) shows it. Pure, so the
 * page, its link preview and its share card agree on every line.
 */

/** One active option. `available` is null when the product doesn't track stock. */
export type ProductOptionPage = {
  id: string;
  name: string;
  /** What this option costs: its own price, or the product's when it has none. */
  price: string;
  available: number | null;
};

export type ProductPage = {
  slug: string;
  name: string;
  description: string | null;
  photos: string[];
  price: string;
  currency: string;
  businessName: string;
  /** The business's city and state, e.g. "Lekki, Lagos". */
  area: string | null;
  /** Payment and fulfilment are set up; sold-out options are a separate state. */
  canBuy: boolean;
  offersDelivery: boolean;
  /** The one delivery fee, or null when delivery isn't offered. */
  deliveryFee: string | null;
  offersPickup: boolean;
  pickupAddress: string | null;
  options: ProductOptionPage[];
};

/** Another live product in the same business, for "More from …". */
export type ProductSummary = {
  slug: string;
  name: string;
  price: string;
  photo: string | null;
};

/** The page and the six-product strip below it. */
export type ProductPageDetail = {
  page: ProductPage;
  others: ProductSummary[];
};

/**
 * "Sold out", "Only 3 left", or nothing once there is comfortable stock.
 * Null means the product is made to order, so there is no number to warn about.
 */
export function availabilityNote(available: number | null): string | null {
  if (available === null) return null;
  if (available <= 0) return "Sold out";
  if (available <= LOW_STOCK) return `Only ${available} left`;
  return null;
}

/**
 * The option a customer lands on: the first one they can buy. When everything
 * is sold out, keep the first so the page still has a price and a state to
 * show; null only when the product has no active options at all.
 */
export function firstAvailableOption(
  options: ProductOptionPage[],
): ProductOptionPage | null {
  return options.find((option) => option.available !== 0) ?? options[0] ?? null;
}

/** Keep the stepper between one and what is left; null means no cap. */
export function capQuantity(quantity: number, available: number | null): number {
  const atLeastOne = Math.max(1, quantity);
  if (available === null) return atLeastOne;
  return Math.max(1, Math.min(atLeastOne, available));
}

/**
 * The link preview: the product, what it costs, where it comes from, and what
 * happens next. Indexed, like a service page.
 */
export function productMetadata(
  page: ProductPage | null,
  path: string,
): Metadata {
  if (!page) return linkNotFoundMetadata(path);

  const price = formatMoney(page.price, page.currency);
  const area = page.area ? ` in ${page.area}` : "";
  const next = page.canBuy
    ? "Pick your option and pay with Paystack."
    : `Message ${page.businessName} to order.`;

  return pageMetadata({
    title: `${page.name} · ${page.businessName}`,
    description: `${price} from ${page.businessName}${area}. ${next}`,
    path,
  });
}

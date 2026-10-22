import { cache } from "react";

import { availableStock } from "@/backend/services/product/stock";
import { db } from "@/server/db";
import type {
  ProductPage,
  ProductPageDetail,
} from "@/utils/product-page";
import { canSellOnline } from "@/utils/selling";

/** Trimmed, comma-joined address parts; blank parts drop, as on the booking page. */
function joinParts(parts: (string | null | undefined)[]) {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * A live product as its public page shows it, with up to six other live
 * products from the same business; null for an unknown slug or a paused
 * product. Stock is what a customer can buy now: shelf stock minus the
 * quantities held by unexpired checkouts.
 *
 * `getProductPage` returns exactly the page; the extra strip is kept on the
 * detail so the page's public type stays the product itself.
 */
export const getProductPageDetail = cache(
  async (slug: string): Promise<ProductPageDetail | null> => {
    const product = await db.product.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true,
        businessId: true,
        slug: true,
        name: true,
        description: true,
        photos: true,
        price: true,
        tracksStock: true,
        options: {
          where: { isActive: true },
          orderBy: { position: "asc" },
          select: { id: true, name: true, price: true },
        },
        business: {
          select: {
            name: true,
            currency: true,
            paystackSubaccountCode: true,
            offersDelivery: true,
            deliveryFee: true,
            offersPickup: true,
            address: true,
            city: true,
            state: true,
          },
        },
      },
    });
    if (!product) return null;

    const available = await availableStock(
      db,
      product.options.map((option) => option.id),
      new Date(),
    );

    const business = product.business;
    const offersDelivery = business.offersDelivery;
    const offersPickup = business.offersPickup;
    const area = joinParts([business.city, business.state]) || null;

    const page: ProductPage = {
      slug: product.slug,
      name: product.name,
      description: product.description,
      photos: product.photos,
      price: product.price.toString(),
      currency: business.currency,
      businessName: business.name,
      area,
      canBuy: canSellOnline({
        isPaymentReady: Boolean(business.paystackSubaccountCode),
        offersDelivery,
        offersPickup,
      }),
      offersDelivery,
      deliveryFee: offersDelivery
        ? (business.deliveryFee?.toString() ?? "0")
        : null,
      offersPickup,
      pickupAddress:
        joinParts([business.address, business.city, business.state]) || null,
      options: product.options.map((option) => ({
        id: option.id,
        name: option.name,
        price: (option.price ?? product.price).toString(),
        available:
          available.get(option.id) ?? (product.tracksStock ? 0 : null),
      })),
    };

    const others = await db.product.findMany({
      where: {
        businessId: product.businessId,
        isActive: true,
        id: { not: product.id },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { slug: true, name: true, price: true, photos: true },
    });

    return {
      page,
      others: others.map((other) => ({
        slug: other.slug,
        name: other.name,
        price: other.price.toString(),
        photo: other.photos[0] ?? null,
      })),
    };
  },
);

/** The product itself, or null for an unknown or paused slug. */
export const getProductPage = cache(
  async (slug: string): Promise<ProductPage | null> => {
    const detail = await getProductPageDetail(slug);
    return detail?.page ?? null;
  },
);

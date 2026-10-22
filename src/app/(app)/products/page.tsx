import { type Metadata } from "next";

import { AppError } from "@/components/app-error";
import { ProductsPageClient } from "@/components/products/products-page-client";
import { getProducts, requireBusiness, toBusinessProfile } from "@/server";
import { cardMetadata } from "@/utils/metadata";
import { appBaseUrl } from "@/utils/url";

export const metadata: Metadata = cardMetadata("products", {
  path: "/products",
  index: false,
});

export default async function ProductsPage() {
  const { business } = await requireBusiness("/products");
  const profile = toBusinessProfile(business);

  let products;
  try {
    products = await getProducts(business.id);
  } catch (error) {
    console.error("[products] failed to load:", error);
    return <AppError title="Your products didn't load." />;
  }

  return (
    <ProductsPageClient
      initialProducts={products}
      currency={profile.currency}
      publicBaseUrl={appBaseUrl()}
      isPaymentReady={profile.isPaymentReady}
      offersDelivery={profile.offersDelivery}
      offersPickup={profile.offersPickup}
    />
  );
}

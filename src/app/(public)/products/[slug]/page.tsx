import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicError } from "@/components/public-error";
import { ProductProfile } from "@/components/public/product-profile";
import { getProductPageDetail } from "@/server/product-page";
import { productPath } from "@/utils/public-links";
import { productMetadata } from "@/utils/product-page";

type Params = { params: Promise<{ slug: string }> };

// A paused product must stop showing at once.
export const dynamic = "force-dynamic";

/** A product's public page; checkout opens in a sheet. Card: ./opengraph-image.tsx. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getProductPageDetail(slug).catch(() => null);
  return productMetadata(detail?.page ?? null, productPath(slug));
}

export default async function ProductPublicPage({ params }: Params) {
  const { slug } = await params;

  let detail;
  try {
    detail = await getProductPageDetail(slug);
  } catch (error) {
    console.error("[products] failed to load product:", error);
    return (
      <PublicError
        title="This product didn't load."
        body="Something went wrong on our side. Refresh the page to try again."
      />
    );
  }

  if (!detail) notFound();

  return <ProductProfile page={detail.page} others={detail.others} />;
}

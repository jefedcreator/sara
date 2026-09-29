import { type Metadata } from "next";
import type { SearchParams } from "nuqs/server";

import { AppError } from "@/components/app-error";
import { ReceiptsPageClient } from "@/components/receipts/receipts-page-client";
import { getReceiptsPage, getServices, requireBusiness } from "@/server";
import { receiptsParamsCache } from "@/utils/url-state";

export const metadata: Metadata = {
  title: "Receipts · Sara",
  robots: { index: false },
};

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { business } = await requireBusiness("/receipts");
  const { page } = await receiptsParamsCache.parse(searchParams);

  let data, services;
  try {
    [data, services] = await Promise.all([
      getReceiptsPage(business.id, page),
      getServices(business.id),
    ]);
  } catch (error) {
    console.error("[receipts] failed to load:", error);
    return <AppError title="Your receipts didn't load." />;
  }

  return <ReceiptsPageClient currency={business.currency} services={services} initial={{ page, data }} />;
}

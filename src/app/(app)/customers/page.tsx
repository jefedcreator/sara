import { type Metadata } from "next";
import type { SearchParams } from "nuqs/server";

import { AppError } from "@/components/app-error";
import { CustomersPageClient } from "@/components/customers/customers-page-client";
import { getCustomersPage, requireBusiness } from "@/server";
import type { CustomerListParams } from "@/utils/api";
import { cardMetadata } from "@/utils/metadata";
import { customersParamsCache } from "@/utils/url-state";

export const metadata: Metadata = cardMetadata("customers", {
  path: "/customers",
  index: false,
});

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { business } = await requireBusiness("/customers");
  const { query, page } = await customersParamsCache.parse(searchParams);
  const params: CustomerListParams = { query: query.trim() || undefined, page };

  let data;
  try {
    data = await getCustomersPage(business.id, params);
  } catch (error) {
    console.error("[customers] failed to load:", error);
    return <AppError title="Your customers didn't load." />;
  }

  return <CustomersPageClient currency={business.currency} initial={{ params, data }} />;
}

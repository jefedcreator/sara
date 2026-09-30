import { type Metadata } from "next";
import type { SearchParams } from "nuqs/server";

import { AppError } from "@/components/app-error";
import { InvoicesPageClient } from "@/components/invoices/invoices-page-client";
import { getInvoicesPage, getServices, requireBusiness } from "@/server";
import { cardMetadata } from "@/utils/metadata";
import { invoiceListParams, invoicesParamsCache } from "@/utils/url-state";

export const metadata: Metadata = cardMetadata("invoices", {
  path: "/invoices",
  index: false,
});

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { business } = await requireBusiness("/invoices");
  const { view, page } = await invoicesParamsCache.parse(searchParams);
  const params = invoiceListParams(view, page);

  let data, services;
  try {
    [data, services] = await Promise.all([
      getInvoicesPage(business.id, params),
      getServices(business.id),
    ]);
  } catch (error) {
    console.error("[invoices] failed to load:", error);
    return <AppError title="Your invoices didn't load." />;
  }

  return (
    <InvoicesPageClient currency={business.currency} services={services} initial={{ params, data }} />
  );
}

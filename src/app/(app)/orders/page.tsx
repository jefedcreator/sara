import { type Metadata } from "next";
import type { SearchParams } from "nuqs/server";

import { AppError } from "@/components/app-error";
import { OrdersPageClient } from "@/components/orders/orders-page-client";
import { getOrdersPage, requireBusiness } from "@/server";
import { cardMetadata } from "@/utils/metadata";
import { appBaseUrl } from "@/utils/url";
import { orderListParams, ordersParamsCache } from "@/utils/url-state";

export const metadata: Metadata = cardMetadata("orders", {
  path: "/orders",
  index: false,
});

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { business } = await requireBusiness("/orders");
  const { view, page } = await ordersParamsCache.parse(searchParams);
  const params = orderListParams(view, page);

  let data;
  try {
    data = await getOrdersPage(business.id, params);
  } catch (error) {
    console.error("[orders] failed to load:", error);
    return <AppError title="Your orders didn't load." />;
  }

  return <OrdersPageClient publicBaseUrl={appBaseUrl()} initial={{ params, data }} />;
}

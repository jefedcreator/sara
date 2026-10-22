import { type Metadata } from "next";
import type { ProductDto } from "types";

import { AppError } from "@/components/app-error";
import { DashboardPageClient } from "@/components/dashboard/dashboard-page-client";
import { getDashboard, getProducts, getServices, requireBusiness, toBusinessProfile } from "@/server";
import { cardMetadata } from "@/utils/metadata";
import { appBaseUrl } from "@/utils/url";

export const metadata: Metadata = cardMetadata("dashboard", {
  path: "/dashboard",
  index: false,
});

export default async function DashboardPage() {
  const { business } = await requireBusiness("/dashboard");

  const { sells } = toBusinessProfile(business);

  // The share sheet (a business that sells both) lists services and products.
  let data, services, products;
  try {
    [data, services, products] = await Promise.all([
      getDashboard(business.id, business.currency),
      getServices(business.id),
      sells === "SERVICES" ? Promise.resolve([] as ProductDto[]) : getProducts(business.id),
    ]);
  } catch (error) {
    console.error("[dashboard] failed to load:", error);
    return <AppError title="Today's numbers didn't load." />;
  }

  return (
    <DashboardPageClient
      initialData={data}
      sells={sells}
      services={services}
      products={products}
      publicBaseUrl={appBaseUrl()}
    />
  );
}

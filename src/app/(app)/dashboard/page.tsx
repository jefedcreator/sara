import { type Metadata } from "next";

import { AppError } from "@/components/app-error";
import { DashboardPageClient } from "@/components/dashboard/dashboard-page-client";
import { getDashboard, getServices, requireBusiness } from "@/server";

export const metadata: Metadata = {
  title: "Today · Sara",
  robots: { index: false },
};

export default async function DashboardPage() {
  const { business } = await requireBusiness("/dashboard");

  let data, services;
  try {
    [data, services] = await Promise.all([
      getDashboard(business.id, business.currency),
      getServices(business.id),
    ]);
  } catch (error) {
    console.error("[dashboard] failed to load:", error);
    return <AppError title="Today's numbers didn't load." />;
  }

  return <DashboardPageClient initialData={data} services={services} />;
}

import { type Metadata } from "next";

import { publicUrl } from "@/backend/services/messaging/url";
import { AppError } from "@/components/app-error";
import { ServicesPageClient } from "@/components/services/services-page-client";
import { getServices, requireBusiness, toBusinessProfile } from "@/server";

export const metadata: Metadata = {
  title: "Services · Sara",
  robots: { index: false },
};

export default async function ServicesPage() {
  const { business } = await requireBusiness("/services");
  const profile = toBusinessProfile(business);

  let services;
  try {
    services = await getServices(business.id);
  } catch (error) {
    console.error("[services] failed to load:", error);
    return <AppError title="Your services didn't load." />;
  }

  return (
    <ServicesPageClient
      initialServices={services}
      currency={profile.currency}
      bookingBaseUrl={publicUrl("book", "").replace(/\/$/, "")}
      isPaymentReady={profile.isPaymentReady}
    />
  );
}

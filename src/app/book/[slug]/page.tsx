import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { BookingPageClient } from "@/components/book/booking-page-client";
import { PublicError } from "@/components/public-error";
import { getPublicService } from "@/server";
import { serviceLabel, todayIso } from "@/utils/format";
import { pageMetadata } from "@/utils/metadata";

type Params = { params: Promise<{ slug: string }> };

// Slots are live; never serve a cached day.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const path = `/book/${encodeURIComponent(slug)}`;
  // The card itself is ./opengraph-image.tsx.
  try {
    const service = await getPublicService(slug, todayIso());
    if (!service) {
      return pageMetadata({
        title: "Booking link not found · Sara",
        description: "This booking link is paused or no longer exists.",
        path,
        index: false,
      });
    }
    const pick =
      service.bookingMode === "NIGHTLY"
        ? "Pick your dates"
        : service.bookingMode === "DAILY"
          ? "Pick your days"
          : "Pick a free time";
    return pageMetadata({
      title: `${service.name} · ${service.businessName}`,
      description: `Book ${serviceLabel(service)} with ${service.businessName}. ${pick} and pay with Paystack.`,
      path,
    });
  } catch {
    return pageMetadata({
      title: "Book a time · Sara",
      description: "Pick a free time and pay with Paystack.",
      path,
    });
  }
}

export default async function BookingPage({ params }: Params) {
  const { slug } = await params;
  const today = todayIso();

  let service;
  try {
    service = await getPublicService(slug, today);
  } catch (error) {
    console.error("[book] failed to load service:", error);
    return (
      <PublicError
        title="This booking page didn't load."
        body="Something went wrong on our side. Refresh the page to try again."
      />
    );
  }

  if (!service) notFound();

  return (
    <BookingPageClient slug={slug} today={today} initialService={service} />
  );
}

import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { BookingPageClient } from "@/components/book/booking-page-client";
import { PublicError } from "@/components/public-error";
import { getPublicService } from "@/server";
import { serviceLabel, todayIso } from "@/utils/format";

type Params = { params: Promise<{ slug: string }> };

// Slots are live; never serve a cached day.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  try {
    const service = await getPublicService(slug, todayIso());
    if (!service) return { title: "Booking link not found · Sara" };
    return {
      title: `${service.name} · ${service.businessName}`,
      description: `Book ${serviceLabel(service)} with ${service.businessName}. Pick a free time and pay with Paystack.`,
    };
  } catch {
    return { title: "Book a time · Sara" };
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

  return <BookingPageClient slug={slug} today={today} initialService={service} />;
}

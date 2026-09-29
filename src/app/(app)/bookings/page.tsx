import { type Metadata } from "next";
import type { SearchParams } from "nuqs/server";

import { AppError } from "@/components/app-error";
import { BookingsPageClient } from "@/components/bookings/bookings-page-client";
import { getBookingsPage, requireBusiness } from "@/server";
import { bookingListParams, bookingsParamsCache } from "@/utils/url-state";

export const metadata: Metadata = {
  title: "Bookings · Sara",
  robots: { index: false },
};

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { business } = await requireBusiness("/bookings");
  const { view, page } = await bookingsParamsCache.parse(searchParams);
  const params = bookingListParams(view, page);

  let data;
  try {
    data = await getBookingsPage(business.id, params);
  } catch (error) {
    console.error("[bookings] failed to load:", error);
    return <AppError title="Your bookings didn't load." />;
  }

  return <BookingsPageClient currency={business.currency} initial={{ params, data }} />;
}

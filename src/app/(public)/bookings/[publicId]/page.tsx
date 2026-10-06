import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicError } from "@/components/public-error";
import { PublicBookingPage } from "@/components/public/booking-page";
import { getPublicBooking } from "@/server";
import { bookingMetadata, bookingView } from "@/utils/booking-view";
import { publicPath } from "@/utils/public-links";

type Params = { params: Promise<{ publicId: string }> };

// Payments, reschedules and cancellations land after the link is sent.
export const dynamic = "force-dynamic";

/** The booking link in the customer's emails (server/share.ts). Card: ./opengraph-image.tsx. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { publicId } = await params;
  const booking = await getPublicBooking(publicId).catch(() => null);
  return bookingMetadata(booking, publicPath("booking", publicId));
}

export default async function BookingPublicPage({ params }: Params) {
  const { publicId } = await params;

  let booking;
  try {
    booking = await getPublicBooking(publicId);
  } catch (error) {
    console.error("[bookings] failed to load booking:", error);
    return (
      <PublicError
        title="This booking didn't load."
        body="Something went wrong on our side. Refresh the page to try again."
      />
    );
  }

  if (!booking) notFound();

  return <PublicBookingPage booking={booking} view={bookingView(booking)} />;
}

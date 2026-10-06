import { getPublicBooking } from "@/server";
import { bookingCard, pageCard } from "@/server/og";
import { bookingView } from "@/utils/booking-view";
import { OG_SIZE } from "@/utils/metadata";

/* A booking link's share card: its date as a calendar leaf. Unknown ids get the site card. */

export const alt = "Your booking";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ publicId: string }> };

export default async function BookingPublicOpenGraphImage({ params }: Params) {
  const { publicId } = await params;
  const booking = await getPublicBooking(publicId).catch(() => null);
  return booking ? bookingCard(booking, bookingView(booking)) : pageCard("site");
}

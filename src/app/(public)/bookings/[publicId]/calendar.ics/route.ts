import { getPublicBooking } from "@/server";
import { publicLink } from "@/server/share";
import { bookingView } from "@/utils/booking-view";
import { bookingIcs } from "@/utils/ics";

/** "Add to calendar" on a booking page: one event, for a booking still to come. */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await params;
  const booking = await getPublicBooking(publicId).catch(() => null);
  if (!booking || bookingView(booking) !== "upcoming") {
    return new Response("Not found", { status: 404 });
  }
  return new Response(bookingIcs(booking, { url: publicLink("booking", booking.publicId) }), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="booking.ics"',
      "cache-control": "no-store",
    },
  });
}

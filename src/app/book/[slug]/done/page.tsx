import { type Metadata } from "next";

import { AwaitConfirmation } from "@/components/book/await-confirmation";
import { PublicError } from "@/components/public-error";
import { Button } from "@/primitives";
import { getBookingReceipt } from "@/server";
import { formatSlotMoment } from "@/utils/format";
import { pageMetadata } from "@/utils/metadata";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PREVIEW: Record<string, (when: string) => string> = {
  CONFIRMED: (when) => `Booked and paid for ${when}.`,
  PENDING: (when) => `Confirming payment for ${when}.`,
  CANCELLED: (when) => `The booking for ${when} was cancelled.`,
};

/*
 * The customer's own confirmation, so never indexed. The card is the
 * service's (../opengraph-image.tsx), named outright: a child segment that
 * sets openGraph doesn't inherit its parent's image file.
 */
export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const { slug } = await params;
  const { b } = await searchParams;
  const book = `/book/${encodeURIComponent(slug)}`;
  const path = `${book}/done`;
  const image = { url: `${book}/opengraph-image`, alt: "Book a time" };
  const booking =
    typeof b === "string" ? await getBookingReceipt(b).catch(() => null) : null;

  if (booking?.serviceSlug !== slug) {
    return pageMetadata({
      title: "Your booking · Sara",
      description: "Your booking confirmation.",
      path,
      image,
      index: false,
    });
  }
  const when = formatSlotMoment(booking.startTime);
  return pageMetadata({
    title: `${booking.serviceName} with ${booking.businessName}`,
    description: (PREVIEW[booking.status] ?? PREVIEW.CONFIRMED!)(when),
    path,
    image,
    index: false,
  });
}

/**
 * Where Paystack returns the customer. The booking is confirmed by Paystack's
 * webhook, not by this visit, so a pending booking waits here and re-checks.
 */
export default async function BookingDonePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = await searchParams;
  const bookingSlug = typeof query.b === "string" ? query.b : null;

  const booking = bookingSlug
    ? await getBookingReceipt(bookingSlug).catch((error: unknown) => {
        console.error("[book/done] lookup failed:", error);
        return null;
      })
    : null;

  // An unknown booking, or one for a different service than the URL claims.
  if (booking?.serviceSlug !== slug) {
    return (
      <PublicError
        title="We couldn't find that booking."
        body="If you paid, your confirmation email is on its way. You can also book again from the service's link."
      >
        <Button asChild variant="secondary">
          <a href={`/book/${encodeURIComponent(slug)}`}>Back to booking</a>
        </Button>
      </PublicError>
    );
  }

  const when = formatSlotMoment(booking.startTime);

  if (booking.status === "CANCELLED") {
    return (
      <PublicError
        title="This booking was cancelled."
        body={`${booking.serviceName} with ${booking.businessName}, ${when}. Pick another time if you'd still like to come.`}
      >
        <Button asChild>
          <a href={`/book/${encodeURIComponent(slug)}`}>Pick another time</a>
        </Button>
      </PublicError>
    );
  }

  if (booking.status === "PENDING") {
    return (
      <PublicError
        title="Confirming your payment…"
        body={`${booking.serviceName} with ${booking.businessName}, ${when}. This usually takes a few seconds.`}
      >
        <AwaitConfirmation />
      </PublicError>
    );
  }

  return (
    <PublicError
      title="You're booked."
      body={`See you ${when}. Your confirmation is in your email, and you'll get a reminder the day before.`}
    >
      <p className="rounded-bubble border-line bg-canvas shadow-bubble w-fit max-w-full rounded-bl-[6px] border px-3.5 py-2.5 text-[14.5px] leading-normal">
        ✅ {booking.serviceName} with {booking.businessName}, {when}. Paid.
      </p>
    </PublicError>
  );
}

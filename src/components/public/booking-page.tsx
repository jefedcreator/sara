import type { ReactNode } from "react";

import { AwaitConfirmation } from "@/components/book/await-confirmation";
import { PublicPage } from "@/components/public/public-page";
import { Button, StatusPill } from "@/primitives";
import {
  bookingPill,
  type BookingView,
  type PublicBooking,
} from "@/utils/booking-view";
import { formatMoney, formatSlotTime, shortDay, unitCount } from "@/utils/format";
import { publicPath } from "@/utils/public-links";

const LINE: Partial<Record<BookingView, string>> = {
  released: "Payment didn't come through, so this time was released.",
  cancelled: "This booking was cancelled.",
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted shrink-0">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Half({ label, day, time }: { label: string; day: string; time: string }) {
  return (
    <div>
      <p className="text-muted text-sm font-semibold">{label}</p>
      <p className="font-display mt-1 text-[22px] leading-[1.2] font-medium tracking-[-0.02em]">
        {day}
      </p>
      <p className="text-muted mt-0.5 text-[15px]">{time}</p>
    </div>
  );
}

/** The booking's time, read like a calendar leaf: one day, or two halves and a length. */
function When({ booking }: { booking: PublicBooking }) {
  const mode = booking.service.bookingMode;
  if (mode === "SLOT") {
    return (
      <div>
        <p className="font-display text-[clamp(2.4rem,1.8rem+2.2vw,3.4rem)] leading-none font-[330] tracking-[-0.035em]">
          {shortDay(booking.startTime)}
        </p>
        <p className="text-ink-2 mt-3 text-[17px]">
          {formatSlotTime(booking.startTime)} to {formatSlotTime(booking.endTime)}
        </p>
      </div>
    );
  }
  const stay = mode === "NIGHTLY";
  return (
    <div>
      <div className="grid grid-cols-2 gap-4">
        <Half
          label={stay ? "Check-in" : "Pickup"}
          day={shortDay(booking.startTime)}
          time={stay ? `From ${formatSlotTime(booking.startTime)}` : formatSlotTime(booking.startTime)}
        />
        <Half
          label={stay ? "Check-out" : "Return"}
          day={shortDay(booking.endTime)}
          time={stay ? `By ${formatSlotTime(booking.endTime)}` : formatSlotTime(booking.endTime)}
        />
      </div>
      <p className="text-accent-ink mt-4 text-[15px] font-semibold">
        {unitCount(mode, booking.units)}
      </p>
    </div>
  );
}

/**
 * The page behind a customer's booking link: what, when and where, whether
 * it's paid, and the one thing to do next (add it to a calendar, or book
 * again). Laid out like the invoice and receipt pages.
 */
export function PublicBookingPage({ booking, view }: { booking: PublicBooking; view: BookingView }) {
  const pill = bookingPill(view);
  const money = formatMoney(booking.amount, booking.currency);
  const paid = booking.status === "CONFIRMED" || booking.status === "COMPLETED";
  const bookAgain = `/book/${encodeURIComponent(booking.service.slug)}`;
  const showReceipt = booking.receiptPath && (view === "upcoming" || view === "past" || view === "done");

  const actions: ReactNode[] = [];
  if (view === "upcoming") {
    actions.push(
      <Button key="calendar" asChild size="lg" className="w-full sm:w-auto">
        <a href={`${publicPath("booking", booking.publicId)}/calendar.ics`} download>
          Add to calendar
        </a>
      </Button>,
    );
  }
  if (view === "released" || view === "cancelled") {
    actions.push(
      <Button key="again" asChild size="lg" className="w-full sm:w-auto">
        <a href={bookAgain}>Book again</a>
      </Button>,
    );
  }
  if (showReceipt) {
    actions.push(
      <Button key="receipt" asChild size="lg" variant="secondary" className="w-full shadow-none sm:w-auto">
        <a href={booking.receiptPath!}>View receipt</a>
      </Button>,
    );
  }
  if (view === "past" || view === "done") {
    actions.push(
      <Button key="again" asChild size="lg" variant="secondary" className="w-full shadow-none sm:w-auto">
        <a href={bookAgain}>Book again</a>
      </Button>,
    );
  }

  return (
    <PublicPage businessName={booking.businessName} credit="Bookings">
      <section aria-labelledby="booking-h" className="animate-rise pt-4 lg:pt-12">
        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
        <h1
          id="booking-h"
          className="font-display mt-4 text-[clamp(2.1rem,1.4rem+3vw,3.4rem)] leading-[1.04] font-[380] tracking-[-0.035em] text-balance"
        >
          {booking.service.name}
        </h1>
        <p className="text-muted mt-3 text-pretty">
          With {booking.businessName}. Booked for {booking.clientName}.
        </p>
      </section>

      <section
        aria-label="When and where"
        className="rounded-panel bg-surface animate-rise-2 mt-8 px-5 py-6 sm:px-6"
      >
        <When booking={booking} />
        {booking.businessAddress || paid || view === "held" ? (
          <dl className="border-line mt-6 space-y-2 border-t pt-5 text-[15px]">
            {booking.businessAddress ? <Fact label="Where">{booking.businessAddress}</Fact> : null}
            {paid ? <Fact label="Paid">{money}</Fact> : null}
            {view === "held" ? <Fact label="To pay">{money}</Fact> : null}
          </dl>
        ) : null}
      </section>

      {view === "held" ? (
        <div className="animate-rise-3 mt-8 grid gap-3">
          <p className="text-muted max-w-[52ch] text-pretty">
            We&apos;re confirming your payment. Your time is held for 30 minutes.
          </p>
          <AwaitConfirmation />
        </div>
      ) : LINE[view] ? (
        <p className="text-muted animate-rise-3 mt-8 max-w-[52ch] text-pretty">{LINE[view]}</p>
      ) : null}

      {actions.length > 0 ? (
        <div className="animate-rise-3 mt-8 flex flex-col gap-3 sm:flex-row">{actions}</div>
      ) : null}
    </PublicPage>
  );
}

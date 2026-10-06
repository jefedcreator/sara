import type { BookingMode, BookingStatus } from "@prisma/client";
import type { Metadata } from "next";

import { wallClockNow } from "@/backend/services/booking/clock";
import { formatSlotMoment, shortDay, unitCount } from "@/utils/format";
import { linkNotFoundMetadata, pageMetadata } from "@/utils/metadata";

/*
 * A customer's booking as its link (/bookings/<publicId>) shows it. Pure, so
 * the page, its link preview, its card and its calendar file agree.
 */

/** What a booking's public page may show: never a phone number or an email. */
export type PublicBooking = {
  publicId: string;
  status: BookingStatus;
  /** Lagos wall-clock written as UTC (utils/format.ts). */
  startTime: string;
  endTime: string;
  units: number;
  /** A real instant: when an unpaid booking stops holding its time. */
  holdExpiresAt: string | null;
  amount: number;
  currency: string;
  clientName: string;
  service: { slug: string; name: string; bookingMode: BookingMode };
  businessName: string;
  /** "12 Admiralty Way, Lekki, Lagos", or null when the business has none. */
  businessAddress: string | null;
  /** "/receipts/<publicId>" of the booking's newest receipt, or null. */
  receiptPath: string | null;
};

export type BookingView =
  | "upcoming" // confirmed, still to come
  | "past" // confirmed, started
  | "done" // marked done by the owner
  | "held" // unpaid, time held
  | "released" // unpaid, hold ran out (or booked before holds existed)
  | "cancelled";

/**
 * Where the booking stands for its customer. Two clocks: startTime is Lagos
 * wall-clock written as UTC, so it is compared with wallClockNow(); the hold
 * is a real instant, compared with `now` itself.
 */
export function bookingView(
  b: Pick<PublicBooking, "status" | "startTime" | "holdExpiresAt">,
  now: Date = new Date(),
): BookingView {
  switch (b.status) {
    case "CANCELLED":
      return "cancelled";
    case "COMPLETED":
      return "done";
    case "PENDING":
      return b.holdExpiresAt && new Date(b.holdExpiresAt) > now ? "held" : "released";
    case "CONFIRMED":
      return new Date(b.startTime) > wallClockNow(now) ? "upcoming" : "past";
  }
}

const PILL: Record<BookingView, { label: string; tone: "accent" | "muted" }> = {
  upcoming: { label: "Confirmed", tone: "accent" },
  past: { label: "Confirmed", tone: "accent" },
  done: { label: "Done", tone: "muted" },
  held: { label: "Awaiting payment", tone: "muted" },
  released: { label: "Expired", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

/** The status pill. An unpaid booking whose hold ran out reads "Expired". */
export function bookingPill(view: BookingView) {
  return PILL[view];
}

/** "Mon 12 Oct at 14:00", "Fri 2 Oct to Mon 5 Oct, 3 nights". */
export function bookingDates(
  b: Pick<PublicBooking, "startTime" | "endTime" | "units"> & { bookingMode: BookingMode },
) {
  if (b.bookingMode === "SLOT") return formatSlotMoment(b.startTime);
  return `${shortDay(b.startTime)} to ${shortDay(b.endTime)}, ${unitCount(b.bookingMode, b.units)}`;
}

/** The link preview: the booking's time and state. Never indexed. */
export function bookingMetadata(
  booking: PublicBooking | null,
  path: string,
  now: Date = new Date(),
): Metadata {
  if (!booking) return linkNotFoundMetadata(path);
  const dates = bookingDates({ ...booking, bookingMode: booking.service.bookingMode });
  const description: Record<BookingView, string> = {
    upcoming: `Confirmed for ${dates}.`,
    past: `Confirmed for ${dates}.`,
    done: `Done on ${shortDay(booking.startTime)}.`,
    held: `Confirming payment for ${dates}.`,
    released: "This booking is no longer active.",
    cancelled: "This booking is no longer active.",
  };
  return pageMetadata({
    title: `${booking.service.name} with ${booking.businessName}`,
    description: description[bookingView(booking, now)],
    path,
    index: false,
  });
}

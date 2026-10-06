import type { BookingMode } from "@prisma/client";
import type { Metadata } from "next";

import { formatDuration, formatMoney, unitCount, unitNoun } from "@/utils/format";
import { linkNotFoundMetadata, pageMetadata } from "@/utils/metadata";

/*
 * A service as its public page (/services/<slug>) shows it. Pure, so the
 * page, its link preview and its share card agree on every line.
 */

export type ServiceSummary = {
  slug: string;
  name: string;
  image: string | null;
  price: string;
  duration: number;
  bookingMode: BookingMode;
};

export type ServicePage = ServiceSummary & {
  description: string | null;
  currency: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  minUnits: number;
  maxUnits: number;
  businessName: string;
  /** Up to six other live services from the same business, newest first. */
  others: ServiceSummary[];
};

type Priced = {
  price: string | number;
  currency: string;
  duration: number;
  bookingMode: BookingMode;
};

/** "NGN 25,000 · 4 hr", "NGN 85,000 per night". */
export function servicePriceLine(s: Priced) {
  const price = formatMoney(s.price, s.currency);
  return s.bookingMode === "SLOT"
    ? `${price} · ${formatDuration(s.duration)}`
    : `${price} per ${unitNoun(s.bookingMode, 1)}`;
}

/** The page's one action, in the booking page's own words. */
export const BOOK_ACTION: Record<BookingMode, string> = {
  SLOT: "Book a time",
  NIGHTLY: "Book your stay",
  DAILY: "Book your rental",
};

/** What the booking page asks for next: the preview's last sentence and the card's pill. */
export const SERVICE_PICK: Record<BookingMode, string> = {
  SLOT: "Pick a time",
  NIGHTLY: "Pick your dates",
  DAILY: "Pick your days",
};

/** "2 to 14 nights", or "3 nights" when there is no choice. */
function unitRange(mode: BookingMode, min: number, max: number) {
  return min === max ? unitCount(mode, min) : `${min} to ${unitCount(mode, max)}`;
}

/** The terms a customer needs before booking, one row each. */
export function serviceTerms(
  s: Pick<
    ServicePage,
    "bookingMode" | "duration" | "checkInTime" | "checkOutTime" | "minUnits" | "maxUnits"
  >,
): { label: string; value: string }[] {
  if (s.bookingMode === "SLOT") {
    return [{ label: "Length", value: formatDuration(s.duration) }];
  }
  const range = unitRange(s.bookingMode, s.minUnits, s.maxUnits);
  if (s.bookingMode === "NIGHTLY") {
    return [
      ...(s.checkInTime ? [{ label: "Check-in", value: `From ${s.checkInTime}` }] : []),
      ...(s.checkOutTime ? [{ label: "Check-out", value: `By ${s.checkOutTime}` }] : []),
      { label: "Stays", value: range },
    ];
  }
  return [
    { label: "Days", value: "24 hours from pickup" },
    { label: "Rentals", value: range },
  ];
}

/** The link preview: what it costs, from whom, and what happens next. Indexed. */
export function serviceMetadata(page: ServicePage | null, path: string): Metadata {
  if (!page) return linkNotFoundMetadata(path);
  const price = formatMoney(page.price, page.currency);
  const cost =
    page.bookingMode === "SLOT"
      ? `${price} for ${formatDuration(page.duration)}`
      : `${price} a ${unitNoun(page.bookingMode, 1)}`;
  return pageMetadata({
    title: `${page.name} · ${page.businessName}`,
    description: `${cost} with ${page.businessName}. ${SERVICE_PICK[page.bookingMode]} and pay with Paystack.`,
    path,
  });
}

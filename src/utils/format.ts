/*
 * Display formatting shared by the app. Pure, client-safe.
 *
 * Time: slot and service times are stored as wall-clock times written in UTC
 * (a "09:00" window is 09:00Z), so they are formatted in UTC to show the
 * number the owner typed. Calendar dates ("today") are Lagos dates.
 */

import type { BookingMode } from "@prisma/client";

const APP_TIME_ZONE = "Africa/Lagos";

/** "NGN 25,000" — the UI form of money (DESIGN.md, Tabular Money Rule). */
export function formatMoney(amount: number | string, currency: string) {
  const value = typeof amount === "string" ? Number(amount) : amount;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
  return currency ? `${currency} ${formatted}` : formatted;
}

/** 240 → "4 hr", 90 → "1 hr 30 min", 45 → "45 min". */
export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/**
 * The product's service label: "Knotless braids — NGN 25,000 (4 hr)",
 * "Lekki 2-bed, Unit 4B — NGN 85,000 / night", "Toyota Prado — NGN 70,000 / day".
 */
export function serviceLabel(service: {
  name: string;
  price: number | string;
  duration: number;
  currency: string;
  bookingMode?: BookingMode;
}) {
  const price = formatMoney(service.price, service.currency);
  const mode = service.bookingMode ?? "SLOT";
  if (mode === "SLOT") return `${service.name} — ${price} (${formatDuration(service.duration)})`;
  return `${service.name} — ${price} / ${unitNoun(mode, 1)}`;
}

/** ISO slot time → "13:00". */
export function formatSlotTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** Today's calendar date in Lagos as YYYY-MM-DD. */
export function todayIso() {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE }).format(
    new Date(),
  );
}

/** YYYY-MM-DD plus n days. */
export function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → parts for a day chip: { weekday: "Mon", day: 28 }. */
export function dayParts(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  return {
    weekday: new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      timeZone: "UTC",
    }).format(date),
    day: date.getUTCDate(),
  };
}

/** YYYY-MM-DD → "Monday 28 September". */
export function formatLongDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00.000Z`));
}

/** ISO slot time → "Mon 28 Sep at 13:00". */
export function formatSlotMoment(iso: string) {
  const date = new Date(iso);
  let day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
  // Normalize "Sept" to "Sep" for consistency across environments
  day = day.replace("Sept", "Sep");
  return `${day} at ${formatSlotTime(iso)}`;
}

/** The 0..6 (Sunday-first) weekday names used by business hours. */
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// ---------- Stays and rentals ----------

/** A booking's times, as the wire carries them. */
export type BookingTimes = {
  bookingMode: BookingMode;
  startTime: string;
  endTime: string;
  units: number;
};

/** "night" / "nights" / "day" / "days". Slot services never count units. */
export function unitNoun(mode: BookingMode, n: number) {
  const word = mode === "NIGHTLY" ? "night" : "day";
  return n === 1 ? word : `${word}s`;
}

/** "3 nights", "1 day". */
export function unitCount(mode: BookingMode, n: number) {
  return `${n} ${unitNoun(mode, n)}`;
}

/** ISO → "Fri 2 Oct" (wall-clock UTC). */
export function shortDay(iso: string) {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(iso));
  // Normalize "Sept" to "Sep" for consistency across environments
  return formatted.replace("Sept", "Sep");
}

/** ISO → "2 Oct" (wall-clock UTC). */
export function dayMonth(iso: string) {
  const formatted = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
  // Normalize "Sept" to "Sep" for consistency across environments
  return formatted.replace("Sept", "Sep");
}

/**
 * The full "when" of a booking:
 * "Mon 28 Sep at 13:00",
 * "Check-in Fri 2 Oct from 14:00 · Check-out Mon 5 Oct by 12:00 · 3 nights",
 * "Pickup Mon 28 Sep, 10:00 · Return Wed 30 Sep, 10:00 · 2 days".
 */
export function bookingWhen(b: BookingTimes) {
  if (b.bookingMode === "SLOT") return formatSlotMoment(b.startTime);
  const count = unitCount(b.bookingMode, b.units);
  if (b.bookingMode === "NIGHTLY") {
    return `Check-in ${shortDay(b.startTime)} from ${formatSlotTime(b.startTime)} · Check-out ${shortDay(b.endTime)} by ${formatSlotTime(b.endTime)} · ${count}`;
  }
  return `Pickup ${shortDay(b.startTime)}, ${formatSlotTime(b.startTime)} · Return ${shortDay(b.endTime)}, ${formatSlotTime(b.endTime)} · ${count}`;
}

/** A compact "when" for lists and subject lines: "2–5 Oct · 3 nights", "30 Sep–2 Oct · 2 nights". */
export function bookingSpan(b: BookingTimes) {
  if (b.bookingMode === "SLOT") return formatSlotMoment(b.startTime);
  const sameMonth = b.startTime.slice(0, 7) === b.endTime.slice(0, 7);
  const from = sameMonth ? String(new Date(b.startTime).getUTCDate()) : dayMonth(b.startTime);
  return `${from}–${dayMonth(b.endTime)} · ${unitCount(b.bookingMode, b.units)}`;
}

/** What happens at a time in today's list. */
export type TodayEventKind = "SLOT" | "CHECK_IN" | "CHECK_OUT" | "PICKUP" | "RETURN";

const TODAY_EVENT_LABEL: Record<TodayEventKind, string> = {
  SLOT: "",
  CHECK_IN: "Check-in",
  CHECK_OUT: "Check-out",
  PICKUP: "Pickup",
  RETURN: "Return",
};

export function todayEventLabel(kind: TodayEventKind) {
  return TODAY_EVENT_LABEL[kind];
}

/** Every YYYY-MM-DD in [from, to). */
export function eachDate(from: string, to: string) {
  const dates: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) dates.push(d);
  return dates;
}

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string) {
  return Math.round(
    (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86_400_000,
  );
}

/** "2026-10-17" → "2026-10-01". */
export function monthStart(isoDate: string) {
  return `${isoDate.slice(0, 7)}-01`;
}

/** "2026-12-01" + 1 → "2027-01-01". */
export function addMonths(month: string, n: number) {
  const date = new Date(`${month}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + n);
  return date.toISOString().slice(0, 10);
}

/** "2026-10-01" → "October 2026". */
export function formatMonth(month: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}T00:00:00.000Z`),
  );
}

/**
 * The nights a stay calendar loads for a month: the month itself plus room
 * for the longest stay starting in it, rounded to whole months.
 */
export function nightsWindow(month: string, maxUnits: number) {
  return { from: month, to: addMonths(month, 1 + Math.ceil(maxUnits / 30)) };
}

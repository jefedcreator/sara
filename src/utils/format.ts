/*
 * Display formatting shared by the app. Pure, client-safe.
 *
 * Time: slot and service times are stored as wall-clock times written in UTC
 * (a "09:00" window is 09:00Z), so they are formatted in UTC to show the
 * number the owner typed. Calendar dates ("today") are Lagos dates.
 */

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

/** "Knotless braids — NGN 25,000 (4 hr)", the product's service label. */
export function serviceLabel(service: {
  name: string;
  price: number | string;
  duration: number;
  currency: string;
}) {
  return `${service.name} — ${formatMoney(service.price, service.currency)} (${formatDuration(service.duration)})`;
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
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
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

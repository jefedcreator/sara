import type { PublicBooking } from "@/utils/booking-view";

/*
 * A one-event calendar file (RFC 5545) for a confirmed booking, behind "Add
 * to calendar". Times are floating (no Z, no TZID): booking times are Lagos
 * wall-clock written as UTC, so the stored digits are the time the customer
 * was shown, and a floating time shows them as they are.
 */

const encoder = new TextEncoder();

/** 2026-10-12T14:00:00.000Z → 20261012T140000. */
const floating = (iso: string) => iso.replace(/[-:]/g, "").slice(0, 15);

/** A real instant, in UTC: 20261006T101500Z. */
const utc = (date: Date) => `${floating(date.toISOString())}Z`;

/** RFC 5545 TEXT: backslash, semicolon and comma escaped; newlines as \n. */
function text(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets; each continuation starts with a space. */
function fold(line: string) {
  const parts: string[] = [];
  let part = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      parts.push(part);
      part = "";
      octets = 0;
    }
    part += char;
    octets += size;
  }
  parts.push(part);
  return parts.join("\r\n ");
}

export function bookingIcs(
  booking: Pick<
    PublicBooking,
    "publicId" | "startTime" | "endTime" | "businessName" | "businessAddress"
  > & { service: { name: string } },
  { url, now = new Date() }: { url: string; now?: Date },
) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sara//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${booking.publicId}@sara`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${floating(booking.startTime)}`,
    `DTEND:${floating(booking.endTime)}`,
    `SUMMARY:${text(`${booking.service.name} with ${booking.businessName}`)}`,
    ...(booking.businessAddress ? [`LOCATION:${text(booking.businessAddress)}`] : []),
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

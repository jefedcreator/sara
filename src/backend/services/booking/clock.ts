/*
 * Booking times are wall-clock times written in UTC: a 14:00 check-in is
 * stored as 14:00Z (see utils/format.ts). These helpers keep that convention.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no daylight saving

/** Lagos wall-clock now, written in UTC like every stored booking time. */
export function wallClockNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + LAGOS_OFFSET_MS);
}

/** "2026-10-02" + "14:00" → 2026-10-02T14:00:00.000Z. */
export function atTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00.000Z`);
}

/** The YYYY-MM-DD of a stored moment. */
export function dateOf(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

/** The HH:mm of a stored moment. */
export function timeOf(moment: Date): string {
  return moment.toISOString().slice(11, 16);
}

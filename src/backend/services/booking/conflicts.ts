import type { BookingMode, Prisma } from "@prisma/client";

/** How long an unpaid booking keeps its time while the customer pays. */
export const HOLD_MINUTES = 30;

export function holdExpiresFrom(now: Date): Date {
  return new Date(now.getTime() + HOLD_MINUTES * 60 * 1000);
}

/** What the conflict rule needs to know about a service. */
export type ConflictService = {
  id: string;
  businessId: string;
  bookingMode: BookingMode;
};

/**
 * Bookings that still hold their time: confirmed, or unpaid with a live hold.
 * `now` is a real instant (holds are real deadlines, not wall-clock times).
 */
export function activeBookingWhere(now: Date = new Date()): Prisma.BookingWhereInput {
  return {
    OR: [
      { status: "CONFIRMED" },
      { status: "PENDING", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
    ],
  };
}

/**
 * The bookings that stop `service` from being booked over `range`.
 *
 * A slot service uses the owner's own time, so any other slot booking in the
 * business blocks it. A stay or rental is a unit (one apartment, one car), so
 * only bookings of that same service block it. The two never block each other.
 * Availability, booking creation and reschedules all use this one rule.
 */
export function blockingBookingsWhere(
  service: ConflictService,
  range: { start: Date; end: Date },
  options: { now?: Date; excludeId?: string } = {},
): Prisma.BookingWhereInput {
  const scope: Prisma.BookingWhereInput =
    service.bookingMode === "SLOT"
      ? { businessId: service.businessId, service: { bookingMode: "SLOT" } }
      : { serviceId: service.id };

  return {
    ...scope,
    ...(options.excludeId ? { id: { not: options.excludeId } } : {}),
    startTime: { lt: range.end },
    endTime: { gt: range.start },
    AND: [activeBookingWhere(options.now)],
  };
}

/** Postgres refused a serializable transaction because another one won the race. */
export function isSerializationFailure(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2034";
}

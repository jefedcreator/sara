import { atTime, dateOf, wallClockNow } from "@/backend/services/booking/clock";
import { blockingBookingsWhere } from "@/backend/services/booking/conflicts";
import { HORIZON_DAYS } from "@/backend/services/booking/terms";
import { db } from "@/server/db";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";
import { addDays, eachDate } from "@/utils/format";

export type NightAvailability = { date: string; isAvailable: boolean };

/**
 * Each night in [from, to) for one apartment. Night d runs from d at
 * check-in to d+1 at check-out; it is free when no blocking booking of the
 * same service overlaps it. Because check-out is never later than check-in,
 * a guest can arrive the day another leaves. Business hours, closures and
 * the owner's Google Calendar don't apply to stays.
 */
export async function getNights(params: {
  serviceId: string;
  from: string;
  to: string;
  excludeBookingId?: string;
  now?: Date;
}): Promise<NightAvailability[]> {
  const service = await db.service.findUnique({
    where: { id: params.serviceId },
    select: { id: true, businessId: true, bookingMode: true, checkInTime: true, checkOutTime: true },
  });
  if (!service) throw new NotFoundException("Service not found");
  if (service.bookingMode !== "NIGHTLY" || !service.checkInTime || !service.checkOutTime) {
    throw new BadRequestException("This service isn't booked by the night");
  }
  const { checkInTime, checkOutTime } = service;

  const bookings = await db.booking.findMany({
    where: blockingBookingsWhere(
      service,
      { start: atTime(params.from, checkInTime), end: atTime(params.to, checkOutTime) },
      { now: params.now, excludeId: params.excludeBookingId },
    ),
    select: { startTime: true, endTime: true },
  });

  const today = dateOf(wallClockNow(params.now));
  const lastNight = addDays(today, HORIZON_DAYS);

  return eachDate(params.from, params.to).map((date) => {
    const start = atTime(date, checkInTime);
    const end = atTime(addDays(date, 1), checkOutTime);
    const taken = bookings.some((b) => b.startTime < end && b.endTime > start);
    return { date, isAvailable: date >= today && date <= lastNight && !taken };
  });
}

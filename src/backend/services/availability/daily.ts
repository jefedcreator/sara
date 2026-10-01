import { DAY_MS, atTime, dateOf, timeOf, wallClockNow } from "@/backend/services/booking/clock";
import { blockingBookingsWhere } from "@/backend/services/booking/conflicts";
import { HORIZON_DAYS } from "@/backend/services/booking/terms";
import { db } from "@/server/db";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";
import { addDays, unitNoun } from "@/utils/format";

import type { AvailabilitySlot } from "./slot";

type Hours = { isClosed: boolean; startTime: string; endTime: string } | null;

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/** A handover at `time` on a day with these hours (no row = open all day). */
function openAt(hours: Hours, time: string) {
  if (!hours) return true;
  return !hours.isClosed && time >= hours.startTime && time <= hours.endTime;
}

/**
 * Pickup times for one car on `date` for a rental of `units` days. A time is
 * free when the pickup and the return (units × 24h later) both fall in
 * working hours on days that aren't days off, and no booking of the same car
 * overlaps the whole rental. The owner's Google Calendar doesn't apply.
 */
export async function getPickupTimes(params: {
  serviceId: string;
  date: string;
  units: number;
  excludeBookingId?: string;
  now?: Date;
}): Promise<AvailabilitySlot[]> {
  const service = await db.service.findUnique({
    where: { id: params.serviceId },
    select: {
      id: true, businessId: true, bookingMode: true,
      availableFrom: true, availableTo: true, minUnits: true, maxUnits: true,
    },
  });
  if (!service) throw new NotFoundException("Service not found");
  if (service.bookingMode !== "DAILY") throw new BadRequestException("This service isn't booked by the day");
  if (!Number.isInteger(params.units) || params.units < service.minUnits || params.units > service.maxUnits) {
    throw new BadRequestException(
      `Book between ${service.minUnits} and ${service.maxUnits} ${unitNoun("DAILY", service.maxUnits)}.`,
    );
  }

  const candidates: Date[] = [];
  for (let m = Math.ceil(minutesOf(service.availableFrom) / 60) * 60; m < minutesOf(service.availableTo); m += 60) {
    const hh = String(m / 60).padStart(2, "0");
    candidates.push(atTime(params.date, `${hh}:00`));
  }
  if (candidates.length === 0) return [];

  const returnDate = addDays(params.date, params.units);
  const { businessId } = service;
  const dayOfWeek = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();

  const [pickupHours, returnHours, pickupClosure, returnClosure, bookings] = await Promise.all([
    db.businessHours.findUnique({ where: { businessId_dayOfWeek: { businessId, dayOfWeek: dayOfWeek(params.date) } } }),
    db.businessHours.findUnique({ where: { businessId_dayOfWeek: { businessId, dayOfWeek: dayOfWeek(returnDate) } } }),
    db.businessClosure.findUnique({ where: { businessId_date: { businessId, date: new Date(params.date) } } }),
    db.businessClosure.findUnique({ where: { businessId_date: { businessId, date: new Date(returnDate) } } }),
    db.booking.findMany({
      where: blockingBookingsWhere(
        service,
        { start: atTime(params.date, "00:00"), end: atTime(addDays(returnDate, 1), "00:00") },
        { now: params.now, excludeId: params.excludeBookingId },
      ),
      select: { startTime: true, endTime: true },
    }),
  ]);

  const wallNow = wallClockNow(params.now);
  const lastDay = addDays(dateOf(wallNow), HORIZON_DAYS);

  return candidates.map((startTime) => {
    const endTime = new Date(startTime.getTime() + params.units * DAY_MS);
    const time = timeOf(startTime);
    const overlaps = bookings.some((b) => b.startTime < endTime && b.endTime > startTime);
    const isAvailable =
      startTime >= wallNow &&
      params.date <= lastDay &&
      openAt(pickupHours, time) &&
      pickupClosure === null &&
      openAt(returnHours, time) &&
      returnClosure === null &&
      !overlaps;
    return { startTime, endTime, isAvailable };
  });
}

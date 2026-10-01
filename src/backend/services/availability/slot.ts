import { blockingBookingsWhere } from "@/backend/services/booking/conflicts";
import { googleCalendarService } from "@/backend/services/googleCalendar";
import { db } from "@/server/db";
import { NotFoundException } from "@/utils/exceptions";

export type AvailabilitySlot = {
  startTime: Date;
  endTime: Date;
  isAvailable: boolean;
};

/**
 * Every candidate slot stepping by `durationMinutes` across
 * [availableFrom, availableTo) on the given date.
 */
function generateCandidateSlots(
  date: string,
  availableFrom: string,
  availableTo: string,
  durationMinutes: number,
): { startTime: Date; endTime: Date }[] {
  const slots: { startTime: Date; endTime: Date }[] = [];
  const dayStart = new Date(`${date}T${availableFrom}:00.000Z`);
  const dayEnd = new Date(`${date}T${availableTo}:00.000Z`);
  const durationMs = durationMinutes * 60 * 1000;
  let current = dayStart.getTime();
  while (current + durationMs <= dayEnd.getTime()) {
    slots.push({ startTime: new Date(current), endTime: new Date(current + durationMs) });
    current += durationMs;
  }
  return slots;
}

/** "HH:mm" on the same day as `date`, as a comparable Date. */
function timeOnDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00.000Z`);
}

/**
 * Every candidate slot for a slot service on a date, each flagged
 * `isAvailable` after business hours, closures, the owner's other slot
 * bookings (live holds only) and Google Calendar busy time.
 */
export async function getSlotAvailability(params: {
  businessId: string;
  serviceId: string;
  date: string;
}): Promise<AvailabilitySlot[]> {
  const { businessId, serviceId, date } = params;

  const service = await db.service.findUnique({
    where: { id: serviceId },
    select: { id: true, businessId: true, bookingMode: true, duration: true, availableFrom: true, availableTo: true },
  });
  if (!service) throw new NotFoundException("Service not found");

  const candidates = generateCandidateSlots(date, service.availableFrom, service.availableTo, service.duration);
  if (candidates.length === 0) return [];

  const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay();

  const [businessHours, closure, existingBookings, business] = await Promise.all([
    db.businessHours.findUnique({ where: { businessId_dayOfWeek: { businessId, dayOfWeek } } }),
    db.businessClosure.findUnique({ where: { businessId_date: { businessId, date: new Date(date) } } }),
    db.booking.findMany({
      where: blockingBookingsWhere(
        { id: service.id, businessId, bookingMode: "SLOT" },
        { start: timeOnDate(date, "00:00"), end: timeOnDate(date, "23:59") },
      ),
      select: { startTime: true, endTime: true },
    }),
    db.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        googleCalendarId: true,
        googleCalendarAccessToken: true,
        googleCalendarRefreshToken: true,
        googleCalendarTokenExpiry: true,
      },
    }),
  ]);

  const isClosureDay = closure !== null;
  const busyIntervals = business ? await googleCalendarService.getBusyIntervals(business, date) : [];

  return candidates.map((slot) => {
    const withinBusinessHours = businessHours
      ? !businessHours.isClosed &&
        slot.startTime >= timeOnDate(date, businessHours.startTime) &&
        slot.endTime <= timeOnDate(date, businessHours.endTime)
      : true; // no row configured — legacy default: open all day
    const overlapsExistingBooking = existingBookings.some(
      (booking) => booking.startTime < slot.endTime && booking.endTime > slot.startTime,
    );
    const overlapsBusyInterval = busyIntervals.some(
      (interval) => interval.start < slot.endTime && interval.end > slot.startTime,
    );
    return {
      ...slot,
      isAvailable: withinBusinessHours && !isClosureDay && !overlapsExistingBooking && !overlapsBusyInterval,
    };
  });
}

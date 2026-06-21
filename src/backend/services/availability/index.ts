import { googleCalendarService } from "@/backend/services/googleCalendar";
import { db } from "@/server/db";
import { NotFoundException } from "@/utils/exceptions";

export type AvailabilitySlot = {
  startTime: Date;
  endTime: Date;
  isAvailable: boolean;
};

/**
 * Generates every candidate slot stepping by `durationMinutes` across
 * [availableFrom, availableTo) on the given date. Mirrors the slot-stepping
 * logic that previously lived inline in the services/[slug] GET handler.
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
    slots.push({
      startTime: new Date(current),
      endTime: new Date(current + durationMs),
    });
    current += durationMs;
  }

  return slots;
}

/** "HH:mm" on the same day as `date`, as a comparable Date. */
function timeOnDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00.000Z`);
}

class AvailabilityService {
  /**
   * Returns every candidate slot for a service on a given date, each flagged
   * `isAvailable` after intersecting business hours, closures, existing
   * businessId-scoped bookings, and (if connected) Google Calendar busy time.
   *
   * Returns every candidate, not just the open ones, so a single call serves
   * both "render the whole day" (today's only caller) and "just show me
   * what's bookable" (`.filter(s => s.isAvailable)`) consumers.
   */
  async getAvailableSlots(params: {
    businessId: string;
    serviceId: string;
    date: string; // "YYYY-MM-DD"
  }): Promise<AvailabilitySlot[]> {
    const { businessId, serviceId, date } = params;

    const service = await db.service.findUnique({
      where: { id: serviceId },
      select: { duration: true, availableFrom: true, availableTo: true },
    });

    if (!service) {
      throw new NotFoundException("Service not found");
    }

    const candidates = generateCandidateSlots(
      date,
      service.availableFrom,
      service.availableTo,
      service.duration,
    );

    if (candidates.length === 0) {
      return [];
    }

    const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay();

    const [businessHours, closure, existingBookings, business] =
      await Promise.all([
        db.businessHours.findUnique({
          where: { businessId_dayOfWeek: { businessId, dayOfWeek } },
        }),
        db.businessClosure.findUnique({
          where: { businessId_date: { businessId, date: new Date(date) } },
        }),
        db.booking.findMany({
          where: {
            businessId,
            status: { in: ["PENDING", "CONFIRMED"] },
            startTime: { lt: timeOnDate(date, "23:59") },
            endTime: { gt: timeOnDate(date, "00:00") },
          },
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

    const busyIntervals = business
      ? await googleCalendarService.getBusyIntervals(business, date)
      : [];

    return candidates.map((slot) => {
      const withinBusinessHours = businessHours
        ? !businessHours.isClosed &&
          slot.startTime >= timeOnDate(date, businessHours.startTime) &&
          slot.endTime <= timeOnDate(date, businessHours.endTime)
        : true; // no row configured — legacy default: open all day

      const overlapsExistingBooking = existingBookings.some(
        (booking) =>
          booking.startTime < slot.endTime &&
          booking.endTime > slot.startTime,
      );

      const overlapsBusyInterval = busyIntervals.some(
        (interval) =>
          interval.start < slot.endTime && interval.end > slot.startTime,
      );

      const isAvailable =
        withinBusinessHours &&
        !isClosureDay &&
        !overlapsExistingBooking &&
        !overlapsBusyInterval;

      return { ...slot, isAvailable };
    });
  }
}

export const availabilityService = new AvailabilityService();

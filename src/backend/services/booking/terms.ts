import { Prisma, type BookingMode } from "@prisma/client";

import { BadRequestException } from "@/utils/exceptions";
import { addDays, unitCount, unitNoun } from "@/utils/format";

import { DAY_MS, atTime, dateOf, timeOf, wallClockNow } from "./clock";

export const HORIZON_DAYS = 180;
const HOUR_MS = 60 * 60 * 1000;

/** What the terms need to know about a service. */
export type TermsService = {
  bookingMode: BookingMode;
  price: Prisma.Decimal | number | string;
  duration: number;
  checkInTime: string | null;
  checkOutTime: string | null;
  minUnits: number;
  maxUnits: number;
};

export type BookingTerms = {
  endTime: Date;
  /** Nights or days; 1 for a slot. */
  units: number;
  /** price × units. */
  amount: Prisma.Decimal;
};

/**
 * When a booking ends and what it costs, from when it starts and how many
 * nights or days it runs. The server's only source for both: clients never
 * send an end time or a price for stays and rentals.
 */
export function bookingTerms(
  service: TermsService,
  startTime: Date,
  units = 1,
  options: { now?: Date; enforceUnitLimits?: boolean } = {},
): BookingTerms {
  const now = wallClockNow(options.now);
  const today = dateOf(now);

  if (dateOf(startTime) > addDays(today, HORIZON_DAYS)) {
    throw new BadRequestException(`Bookings open up to ${HORIZON_DAYS} days ahead. Pick an earlier date.`);
  }

  if (service.bookingMode === "SLOT") {
    if (startTime < now) throw new BadRequestException("That time has passed. Pick a later one.");
    return {
      endTime: new Date(startTime.getTime() + service.duration * 60 * 1000),
      units: 1,
      amount: new Prisma.Decimal(service.price),
    };
  }

  const mode = service.bookingMode;
  if (!Number.isInteger(units) || units < 1) {
    throw new BadRequestException(`Pick how many ${unitNoun(mode, 2)}.`);
  }
  if (options.enforceUnitLimits !== false && (units < service.minUnits || units > service.maxUnits)) {
    throw new BadRequestException(
      service.minUnits === service.maxUnits
        ? `This books for exactly ${unitCount(mode, service.minUnits)}.`
        : `Book between ${service.minUnits} and ${service.maxUnits} ${unitNoun(mode, service.maxUnits)}.`,
    );
  }
  const amount = new Prisma.Decimal(service.price).mul(units);

  if (mode === "NIGHTLY") {
    if (!service.checkInTime || !service.checkOutTime) {
      throw new BadRequestException("This stay can't be booked yet: its check-in and check-out times aren't set.");
    }
    if (timeOf(startTime) !== service.checkInTime) {
      throw new BadRequestException(`Check-in is from ${service.checkInTime}.`);
    }
    // By date, not time: a guest may book tonight's stay after the check-in hour.
    if (dateOf(startTime) < today) {
      throw new BadRequestException("That check-in date has passed. Pick a later one.");
    }
    return {
      endTime: atTime(addDays(dateOf(startTime), units), service.checkOutTime),
      units,
      amount,
    };
  }

  if (startTime.getTime() % HOUR_MS !== 0) {
    throw new BadRequestException("Pickup times are on the hour.");
  }
  if (startTime < now) throw new BadRequestException("That pickup time has passed. Pick a later one.");
  return { endTime: new Date(startTime.getTime() + units * DAY_MS), units, amount };
}

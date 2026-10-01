"use client";

import { useMemo, useState } from "react";
import type { PublicServiceDto } from "types";

import { usePublicNightsQuery } from "@/hooks/queries/use-public-service";
import { Notice } from "@/primitives";
import {
  addDays,
  addMonths,
  bookingSpan,
  bookingWhen,
  daysBetween,
  eachDate,
  monthStart,
  nightsWindow,
} from "@/utils/format";

import { StayCalendar, type CalendarDay } from "./stay-calendar";
import type { Selection } from "./types";

const HORIZON_DAYS = 180;

interface StayPickerProps {
  slug: string;
  service: PublicServiceDto;
  today: string;
  onChange: (selection: Selection | null) => void;
}

/** Tap check-in, then check-out. Nights are checked against both months shown and booked. */
export function StayPicker({ slug, service, today, onChange }: StayPickerProps) {
  const firstMonth = monthStart(today);
  const lastMonth = monthStart(addDays(today, HORIZON_DAYS));
  const [month, setMonth] = useState(firstMonth);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const initialFor = (m: string) =>
    m === firstMonth ? { ...nightsWindow(m, service.maxUnits), data: service } : undefined;
  // What's on screen, and (while picking check-out) the month the stay starts
  // in, whose window reaches the longest stay.
  const view = usePublicNightsQuery(slug, nightsWindow(month, service.maxUnits), initialFor(month));
  const anchorMonth = checkIn ? monthStart(checkIn) : month;
  const anchor = usePublicNightsQuery(slug, nightsWindow(anchorMonth, service.maxUnits), initialFor(anchorMonth));

  const free = useMemo(
    () =>
      new Set(
        [...(view.data?.nights ?? []), ...(anchor.data?.nights ?? [])]
          .filter((n) => n.isAvailable)
          .map((n) => n.date),
      ),
    [view.data, anchor.data],
  );

  const min = service.minUnits;
  const max = service.maxUnits;
  const lengthRule = min === max ? `Stays here are exactly ${min} night${min === 1 ? "" : "s"}.` : `Stays here are ${min} to ${max} nights.`;

  function pick(date: string) {
    setProblem(null);
    const startingOver = !checkIn || checkOut !== null || date <= checkIn;
    if (startingOver) {
      if (!free.has(date)) {
        setProblem("That night is booked. Pick another check-in date.");
        return;
      }
      setCheckIn(date);
      setCheckOut(null);
      onChange(null);
      return;
    }
    const nights = daysBetween(checkIn, date);
    if (nights < min || nights > max) {
      setProblem(lengthRule);
      return;
    }
    if (eachDate(checkIn, date).some((night) => !free.has(night))) {
      setProblem("Some nights in those dates are booked. Pick different dates.");
      return;
    }
    setCheckOut(date);
    const times = {
      bookingMode: "NIGHTLY" as const,
      startTime: `${checkIn}T${service.checkInTime}:00.000Z`,
      endTime: `${date}T${service.checkOutTime}:00.000Z`,
      units: nights,
    };
    onChange({ ...times, when: bookingWhen(times), short: bookingSpan(times), total: Number(service.price) * nights });
  }

  const awaitingCheckOut = Boolean(checkIn && !checkOut);
  const days: CalendarDay[] = eachDate(month, addMonths(month, 1)).map((date) => {
    const past = date < today;
    const isFree = free.has(date);
    const selected =
      date === checkIn
        ? ("start" as const)
        : date === checkOut
          ? ("end" as const)
          : checkIn && checkOut && date > checkIn && date < checkOut
            ? ("between" as const)
            : null;
    return {
      date,
      state: past ? "past" : isFree ? "free" : "taken",
      selected,
      // A booked night can still be a check-out day: you leave that morning.
      selectable: !past && (isFree || (awaitingCheckOut && date > checkIn!)),
    };
  });

  return (
    <>
      <h2 className="text-ink-2 text-sm font-semibold">
        {awaitingCheckOut ? "Pick your check-out date" : "Pick your check-in date"}
      </h2>
      <div className="mt-2.5">
        {view.isError && !view.data ? (
          <Notice tone="danger">
            We couldn&apos;t load these dates.{" "}
            <button type="button" className="cursor-pointer font-semibold underline" onClick={() => void view.refetch()}>
              Try again
            </button>
          </Notice>
        ) : (
          <StayCalendar
            month={month}
            days={days}
            onPick={pick}
            onPrev={month > firstMonth ? () => setMonth(addMonths(month, -1)) : null}
            onNext={month < lastMonth ? () => setMonth(addMonths(month, 1)) : null}
            isStale={view.isPlaceholderData || view.isPending}
          />
        )}
      </div>
      <p className="text-muted mt-3 text-[13px]">{lengthRule}</p>
      {problem ? (
        <Notice tone="neutral" className="mt-3">
          {problem}
        </Notice>
      ) : null}
    </>
  );
}

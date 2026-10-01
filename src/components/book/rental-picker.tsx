"use client";

import { useMemo, useState } from "react";
import type { PublicServiceDto, TimeSlot } from "types";

import { usePublicPickupsQuery } from "@/hooks/queries/use-public-service";
import { Notice } from "@/primitives";
import { addDays, bookingSpan, bookingWhen, formatLongDate, unitNoun } from "@/utils/format";

import { DayCountStepper } from "./day-count-stepper";
import { DayStrip } from "./day-strip";
import { SlotGrid, SlotGridSkeleton } from "./slot-grid";
import type { Selection } from "./types";

const DAYS_AHEAD = 60;

interface RentalPickerProps {
  slug: string;
  service: PublicServiceDto;
  today: string;
  onChange: (selection: Selection | null) => void;
}

/** How many days, then a pickup day and time. The car is due back at the same time. */
export function RentalPicker({ slug, service, today, onChange }: RentalPickerProps) {
  const [units, setUnits] = useState(service.minUnits);
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)), [today]);
  const isInitial = date === today && units === service.minUnits;
  const query = usePublicPickupsQuery(
    slug,
    date,
    units,
    isInitial ? { date: today, units: service.minUnits, data: service } : undefined,
  );
  const slots = query.data?.slots ?? [];
  const hasOpen = slots.some((s) => s.isAvailable);

  function choose(next: TimeSlot | null, count = units) {
    setSlot(next);
    if (!next) return onChange(null);
    const times = { bookingMode: "DAILY" as const, startTime: next.startTime, endTime: next.endTime, units: count };
    onChange({ ...times, when: bookingWhen(times), short: bookingSpan(times), total: Number(service.price) * count });
  }

  return (
    <>
      <h2 className="text-ink-2 text-sm font-semibold">How many days?</h2>
      <div className="mt-2.5">
        <DayCountStepper
          value={units}
          min={service.minUnits}
          max={service.maxUnits}
          noun={(n) => unitNoun("DAILY", n)}
          onChange={(n) => {
            setUnits(n);
            choose(null, n);
          }}
        />
      </div>

      <h2 className="text-ink-2 mt-6 text-sm font-semibold">Pickup day</h2>
      <div className="mt-2.5">
        <DayStrip
          days={days}
          selected={date}
          onSelect={(next) => {
            setDate(next);
            choose(null);
          }}
        />
      </div>

      <h2 className="text-ink-2 mt-6 text-sm font-semibold">Pickup times, {formatLongDate(date)}</h2>
      <div className="mt-2.5">
        {query.isError && !query.data ? (
          <Notice tone="danger">
            We couldn&apos;t load this day.{" "}
            <button type="button" className="cursor-pointer font-semibold underline" onClick={() => void query.refetch()}>
              Try again
            </button>
          </Notice>
        ) : query.isPending ? (
          <SlotGridSkeleton />
        ) : !hasOpen && !query.isPlaceholderData ? (
          <Notice tone="neutral">No pickup times on this day. Try another day, or fewer days.</Notice>
        ) : (
          <SlotGrid slots={slots} selected={slot?.startTime ?? null} onSelect={(s) => choose(s)} isStale={query.isPlaceholderData} />
        )}
      </div>
    </>
  );
}

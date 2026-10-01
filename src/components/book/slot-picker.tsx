"use client";

import { useMemo, useState } from "react";
import type { PublicServiceDto, TimeSlot } from "types";

import { usePublicServiceQuery } from "@/hooks/queries/use-public-service";
import { Notice } from "@/primitives";
import { addDays, bookingSpan, bookingWhen, formatLongDate } from "@/utils/format";

import { DayStrip } from "./day-strip";
import { SlotGrid, SlotGridSkeleton } from "./slot-grid";
import type { Selection } from "./types";

const DAYS_AHEAD = 14;

interface SlotPickerProps {
  slug: string;
  service: PublicServiceDto;
  today: string;
  onChange: (selection: Selection | null) => void;
}

/** Pick a day, then a free time. */
export function SlotPicker({ slug, service, today, onChange }: SlotPickerProps) {
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)), [today]);
  const query = usePublicServiceQuery(slug, date, { date: today, data: service });
  const slots = query.data?.slots ?? [];
  const hasOpenSlot = slots.some((s) => s.isAvailable && new Date(s.startTime).getTime() > Date.now());

  function choose(next: TimeSlot | null) {
    setSlot(next);
    if (!next) return onChange(null);
    const times = { bookingMode: "SLOT" as const, startTime: next.startTime, endTime: next.endTime, units: 1 };
    onChange({ ...times, when: bookingWhen(times), short: bookingSpan(times), total: Number(service.price) });
  }

  return (
    <>
      <h2 className="text-ink-2 text-sm font-semibold">Pick a day</h2>
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

      <h2 className="text-ink-2 mt-6 text-sm font-semibold">Free times, {formatLongDate(date)}</h2>
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
        ) : !hasOpenSlot && !query.isPlaceholderData ? (
          <Notice tone="neutral">No free times on this day. Try another day.</Notice>
        ) : (
          <SlotGrid slots={slots} selected={slot?.startTime ?? null} onSelect={choose} isStale={query.isPlaceholderData} />
        )}
      </div>
    </>
  );
}

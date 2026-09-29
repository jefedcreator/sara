"use client";

import { useState } from "react";
import type { BusinessHoursDto } from "types";

import { Button, Notice, Switch, TimePicker } from "@/primitives";
import type { BusinessHoursInput } from "@/utils/api";
import { WEEKDAYS } from "@/utils/format";

import { Section } from "./section";

// Monday first; dayOfWeek stays 0 = Sunday for the API.
const ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

function toWeek(hours: BusinessHoursDto[]): BusinessHoursInput[] {
  return ORDER.map((dayOfWeek) => {
    const row = hours.find((h) => h.dayOfWeek === dayOfWeek);
    return {
      dayOfWeek,
      startTime: row?.startTime ?? "09:00",
      endTime: row?.endTime ?? "17:00",
      isClosed: row?.isClosed ?? false,
    };
  });
}

interface HoursSectionProps {
  hours: BusinessHoursDto[];
  onSave: (days: BusinessHoursInput[], onSaved: () => void) => void;
  isPending: boolean;
  error: string | null;
  saved: boolean;
}

/**
 * The weekly schedule. With no rows saved, every day is open (the API's
 * default); the form shows 09:00–17:00 as a starting point.
 */
export function HoursSection({ hours, onSave, isPending, error, saved }: HoursSectionProps) {
  const [week, setWeek] = useState(() => toWeek(hours));
  const [dirty, setDirty] = useState(false);
  const invalid = week.some((d) => !d.isClosed && d.startTime >= d.endTime);

  function change(dayOfWeek: number, patch: Partial<BusinessHoursInput>) {
    setWeek((days) => days.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
    setDirty(true);
  }

  return (
    <Section
      id="hours-h"
      title="Working hours"
      description={
        hours.length === 0
          ? "Not set yet, so every day is open within each service's hours. Save to set your week."
          : "Booking links only offer times inside these hours."
      }
    >
      <ul className="divide-line grid divide-y">
        {week.map((day) => {
          const name = WEEKDAYS[day.dayOfWeek];
          const wrongWayRound = !day.isClosed && day.startTime >= day.endTime;
          return (
            <li key={day.dayOfWeek} className="grid gap-3 py-3.5 first:pt-0 last:pb-0 sm:grid-cols-[180px_1fr] sm:items-center">
              <label className="flex cursor-pointer items-center gap-3 text-[15px] font-semibold">
                <Switch
                  checked={!day.isClosed}
                  onCheckedChange={(open) => change(day.dayOfWeek, { isClosed: !open })}
                  aria-label={`Open on ${name}`}
                />
                {name}
              </label>
              {day.isClosed ? (
                <p className="text-faint text-[15px]">Closed</p>
              ) : (
                <div className="flex items-center gap-2">
                  <TimePicker
                    aria-label={`${name} opens`}
                    value={day.startTime}
                    onChange={(startTime) => change(day.dayOfWeek, { startTime })}
                    invalid={wrongWayRound}
                    className="w-[124px]"
                  />
                  <span className="text-muted text-sm">to</span>
                  <TimePicker
                    aria-label={`${name} closes`}
                    value={day.endTime}
                    onChange={(endTime) => change(day.dayOfWeek, { endTime })}
                    invalid={wrongWayRound}
                    className="w-[124px]"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {invalid ? (
        <Notice tone="danger" className="mt-5">
          Each open day has to close after it opens.
        </Notice>
      ) : error ? (
        <Notice tone="danger" className="mt-5">
          {error}
        </Notice>
      ) : null}

      <div className="mt-6 flex items-center gap-4">
        <Button
          variant="dark"
          isLoading={isPending}
          disabled={invalid || (!dirty && hours.length > 0)}
          onClick={() =>
            onSave(
              week.map((d) => ({
                ...d,
                startTime: d.startTime.slice(0, 5),
                endTime: d.endTime.slice(0, 5),
              })),
              () => setDirty(false),
            )
          }
        >
          Save hours
        </Button>
        {saved && !dirty ? (
          <p className="text-accent-ink text-sm font-semibold" role="status">
            Saved
          </p>
        ) : null}
      </div>
    </Section>
  );
}

import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";

import { cn } from "@/utils/cn";
import { formatLongDate, formatMonth } from "@/utils/format";

export type CalendarDay = {
  date: string; // YYYY-MM-DD
  state: "free" | "taken" | "past";
  selected: "start" | "end" | "between" | null;
  selectable: boolean;
};

interface StayCalendarProps {
  month: string; // YYYY-MM-01
  days: CalendarDay[]; // every day of `month`, in order
  onPick: (date: string) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  isStale: boolean;
}

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const NAV =
  "grid size-10 cursor-pointer place-items-center rounded-full text-ink transition-[background-color,scale] duration-200 ease-out-expo hover:bg-surface active:scale-96 disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent";

/**
 * A month of nights, Monday first. Booked nights are leaf grey and struck
 * through like taken slots; the stay is a green fill at each end with a mint
 * wash between (DESIGN.md slot language). Pure: the parent decides states.
 */
export function StayCalendar({ month, days, onPick, onPrev, onNext, isStale }: StayCalendarProps) {
  const lead = (new Date(`${month}T00:00:00.000Z`).getUTCDay() + 6) % 7;

  return (
    <div>
      <div className="flex items-center justify-between">
        <button type="button" className={NAV} aria-label="Previous month" disabled={!onPrev} onClick={onPrev ?? undefined}>
          <CaretLeft size={18} weight="bold" aria-hidden="true" />
        </button>
        <p className="font-display text-lg font-medium tracking-[-0.015em]" aria-live="polite">
          {formatMonth(month)}
        </p>
        <button type="button" className={NAV} aria-label="Next month" disabled={!onNext} onClick={onNext ?? undefined}>
          <CaretRight size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>

      <div
        className={cn("mt-3 grid grid-cols-7 gap-y-1 transition-opacity duration-200", isStale && "opacity-50")}
        aria-busy={isStale || undefined}
      >
        {WEEK.map((w) => (
          <span key={w} className="text-faint pb-1 text-center text-xs font-medium">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden="true" />
        ))}
        {days.map((day) => {
          const ends = day.selected === "start" || day.selected === "end";
          return (
            <button
              key={day.date}
              type="button"
              disabled={!day.selectable}
              aria-pressed={day.selected !== null}
              aria-label={`${formatLongDate(day.date)}${day.state === "taken" ? ", booked" : ""}`}
              onClick={() => onPick(day.date)}
              className={cn(
                "h-11 cursor-pointer text-[15px] font-semibold transition-[background-color,scale] duration-200 ease-out-expo active:scale-96 disabled:cursor-default disabled:active:scale-100",
                !day.selected && "rounded-[12px]",
                !day.selected && day.state === "free" && "text-ink hover:bg-surface",
                !day.selected && day.state !== "free" && "text-faint line-through",
                day.selected === "between" && "bg-accent-soft text-accent-ink",
                ends && "bg-accent text-on-accent rounded-[12px]",
              )}
            >
              {Number(day.date.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

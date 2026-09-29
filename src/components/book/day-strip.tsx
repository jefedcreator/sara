import { cn } from "@/utils/cn";
import { dayParts } from "@/utils/format";

interface DayStripProps {
  days: string[];
  selected: string;
  onSelect: (date: string) => void;
}

/** Two weeks of day chips. The picked day is a green fill (DESIGN.md slots). */
export function DayStrip({ days, selected, onSelect }: DayStripProps) {
  return (
    <div
      className="-mx-4 flex snap-x scroll-px-4 gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      aria-label="Pick a day"
    >
      {days.map((date, index) => {
        const { weekday, day } = dayParts(date);
        const isSelected = date === selected;
        return (
          <button
            key={date}
            type="button"
            onClick={() => onSelect(date)}
            aria-pressed={isSelected}
            aria-label={index === 0 ? `Today, ${weekday} ${day}` : `${weekday} ${day}`}
            className={cn(
              "grid w-[58px] shrink-0 cursor-pointer snap-start justify-items-center gap-0.5 rounded-[14px] border py-2 text-xs transition-[background-color,border-color,scale] duration-200 ease-out-expo active:scale-96",
              isSelected
                ? "border-accent bg-accent text-on-accent"
                : "border-line text-muted hover:border-ink-2",
            )}
          >
            {index === 0 ? "Today" : weekday}
            <b
              className={cn(
                "text-[17px] leading-none font-semibold",
                isSelected ? "text-on-accent" : "text-ink",
              )}
            >
              {day}
            </b>
          </button>
        );
      })}
    </div>
  );
}

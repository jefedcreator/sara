import type { TimeSlot } from "types";

import { Skeleton } from "@/primitives";
import { cn } from "@/utils/cn";
import { formatSlotTime } from "@/utils/format";

interface SlotGridProps {
  slots: TimeSlot[];
  selected: string | null;
  onSelect: (slot: TimeSlot) => void;
  /** The previous day is still on screen while the new one loads. */
  isStale: boolean;
}

/**
 * Time pills. Free = white with a hairline; picked = mint wash with a deep
 * teal outline; taken or already past = leaf grey, struck through.
 */
export function SlotGrid({ slots, selected, onSelect, isStale }: SlotGridProps) {
  const now = Date.now();

  return (
    <ul
      className={cn(
        "grid grid-cols-3 gap-1.5 transition-opacity duration-200 sm:grid-cols-4",
        isStale && "opacity-50",
      )}
      aria-busy={isStale || undefined}
    >
      {slots.map((slot) => {
        const isOpen = slot.isAvailable && new Date(slot.startTime).getTime() > now;
        const isSelected = slot.startTime === selected;
        const time = formatSlotTime(slot.startTime);
        return (
          <li key={slot.startTime}>
            <button
              type="button"
              disabled={!isOpen || isStale}
              onClick={() => onSelect(slot)}
              aria-pressed={isSelected}
              aria-label={isOpen ? time : `${time}, taken`}
              className={cn(
                "w-full cursor-pointer rounded-full border py-2.5 text-center text-sm font-semibold transition-[background-color,border-color,scale] duration-200 ease-out-expo active:scale-96 disabled:cursor-not-allowed disabled:active:scale-100",
                !isOpen && "bg-surface text-faint border-transparent line-through",
                isOpen && !isSelected && "border-line hover:border-ink-2",
                isOpen && isSelected && "border-accent-ink bg-accent-soft text-accent-ink",
              )}
            >
              {time}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function SlotGridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-[42px] rounded-full" />
      ))}
    </div>
  );
}

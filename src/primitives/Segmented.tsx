"use client";

import { cn } from "@/utils/cn";

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}

/**
 * A row of pill choices, one selected (a filter or a form mode). Selected is
 * ink on white inside a leaf-grey track, so green stays for actions.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "bg-surface inline-flex max-w-full gap-1 overflow-x-auto rounded-full p-1 [scrollbar-width:none]",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-[background-color,color] duration-200",
              selected
                ? "bg-canvas text-ink shadow-bubble"
                : "text-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

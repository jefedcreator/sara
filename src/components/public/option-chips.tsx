"use client";

import { cn } from "@/utils/cn";
import type { ProductOptionPage } from "@/utils/product-page";

/**
 * Sizes, lengths or colours, as DESIGN.md's booking slots read: an available
 * option is white with a hairline, the chosen one a mint wash with a deep teal
 * outline, and a sold-out one leaf grey with struck-through faint text that
 * can't be picked. A product's one unnamed option has nothing to choose, so
 * the row stays out of the way.
 */
export function OptionChips({
  options,
  selectedId,
  onSelect,
}: {
  options: ProductOptionPage[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (options.length <= 1 && !options[0]?.name) return null;

  return (
    <div role="radiogroup" aria-label="Option" className="flex flex-wrap gap-2">
      {options.map((option) => {
        const soldOut = option.available === 0;
        const selected = option.id === selectedId;

        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={soldOut}
            onClick={() => onSelect(option.id)}
            className={cn(
              "min-h-10 cursor-pointer rounded-full border px-4 text-sm font-semibold transition-[background-color,border-color,color,scale] duration-150 motion-safe:active:scale-[0.97]",
              "border-line bg-canvas text-ink hover:border-ink",
              selected &&
                "border-accent-soft bg-accent-soft text-accent-ink outline outline-2 outline-accent-ink -outline-offset-2 hover:border-accent-soft",
              soldOut &&
                "border-line bg-surface text-faint hover:border-line cursor-not-allowed line-through active:scale-100",
            )}
          >
            {option.name || "One option"}
          </button>
        );
      })}
    </div>
  );
}

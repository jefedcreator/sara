"use client";

import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import type { ComponentProps } from "react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/utils/cn";

const navButtonClasses =
  "text-ink-2 hover:bg-surface hover:text-ink grid size-9 cursor-pointer place-items-center rounded-full transition-[background-color,color,scale] duration-200 ease-out-expo active:scale-96 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent";

/*
 * Calendar: shadcn's react-day-picker wrapper, restyled to DESIGN.md. Every
 * part is styled through `classNames`, so react-day-picker's own stylesheet
 * is not loaded. Days are pills like booking slots: the picked day is a green
 * fill with green-ink text, today is deep teal, days from the next or last
 * month are muted, and days that can't be picked fade out. Weeks start on
 * Monday.
 *
 * Modifier classes land on the day cell, so the day button reads the cell's
 * `data-*` state through `group/day`.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={1}
      className={cn("text-ink", className)}
      classNames={{
        root: "relative w-fit",
        months: "flex flex-col gap-4 sm:flex-row",
        month: "grid gap-3",
        month_caption: "flex h-9 items-center justify-center px-10",
        caption_label:
          "font-display text-[17px] font-medium tracking-[-0.02em]",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: navButtonClasses,
        button_next: navButtonClasses,
        month_grid: "border-collapse",
        weekdays: "flex",
        weekday: "text-muted w-10 pb-1 text-xs font-medium",
        week: "mt-1 flex",
        day: "group/day size-10 p-0.5 text-center",
        day_button: cn(
          "grid size-9 cursor-pointer place-items-center rounded-full text-[15px] font-medium transition-[background-color,color,scale] duration-200 ease-out-expo",
          "hover:bg-surface active:scale-96 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink",
          "group-data-today/day:text-accent-ink group-data-today/day:font-bold",
          "group-data-outside/day:text-muted group-data-outside/day:font-normal",
          "group-data-selected/day:bg-accent group-data-selected/day:text-on-accent group-data-selected/day:hover:bg-accent-hover",
          "group-data-disabled/day:cursor-not-allowed group-data-disabled/day:font-normal group-data-disabled/day:text-faint/60! group-data-disabled/day:hover:bg-transparent group-data-disabled/day:active:scale-100",
        ),
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <CaretLeft weight="bold" className="size-4" />
          ) : (
            <CaretRight weight="bold" className="size-4" />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };

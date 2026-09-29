"use client";

import { CalendarBlank } from "@phosphor-icons/react/dist/ssr";
import { Popover } from "radix-ui";
import { forwardRef, useState } from "react";

import { cn } from "@/utils/cn";
import { todayIso } from "@/utils/format";

import { Button } from "./Button";
import { Calendar } from "./Calendar";
import { useFieldContext } from "./Field";
import { controlClasses } from "./Input";

/*
 * DatePicker: an input-styled trigger that opens the Calendar in a Radix
 * Popover (shadcn's date picker). Values are the app's `YYYY-MM-DD` strings,
 * "" when empty, so it drops into react-hook-form through a Controller.
 *
 * The strings are converted at local midnight: react-day-picker reads dates
 * in the device's zone, and a UTC midnight would show the day before for
 * anyone west of Greenwich. "Today" is the business's (todayIso), not the
 * device's.
 */

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Earliest pickable day, `YYYY-MM-DD`. */
  min?: string;
  placeholder?: string;
  /** Offer a "Clear" action, for optional dates. */
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}

function toDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year!, month! - 1, day);
}

function toIso(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const labelFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DatePicker = forwardRef<HTMLButtonElement, DatePickerProps>(
  (
    {
      value,
      onChange,
      onBlur,
      min,
      placeholder = "Pick a date",
      clearable = false,
      disabled,
      className,
    },
    ref,
  ) => {
    const field = useFieldContext();
    const [open, setOpen] = useState(false);
    const selected = value ? toDate(value) : undefined;
    const today = toDate(todayIso());

    return (
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) onBlur?.();
        }}
      >
        <Popover.Trigger asChild>
          <button
            ref={ref}
            type="button"
            id={field?.id}
            disabled={disabled}
            // aria-invalid is not valid on a button; the error is still
            // announced through aria-describedby.
            data-invalid={field?.invalid ? true : undefined}
            aria-describedby={field?.describedBy}
            className={cn(
              controlClasses,
              "flex h-11 cursor-pointer items-center justify-between gap-3 text-left",
              "data-[state=open]:border-accent-ink data-[state=open]:ring-accent-tint data-[state=open]:ring-3",
              "data-invalid:border-danger data-invalid:data-[state=open]:ring-danger-soft",
              className,
            )}
          >
            <span className={cn("truncate", !value && "text-muted")}>
              {value
                ? labelFormat.format(new Date(`${value}T00:00:00.000Z`))
                : placeholder}
            </span>
            <CalendarBlank
              aria-hidden="true"
              weight="bold"
              className="text-muted size-4 shrink-0"
            />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={8}
            collisionPadding={16}
            className={cn(
              "bg-canvas border-line rounded-card shadow-lift z-60 border p-3",
              "data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in",
            )}
          >
            <Calendar
              mode="single"
              autoFocus
              today={today}
              selected={selected}
              defaultMonth={selected ?? today}
              disabled={min ? { before: toDate(min) } : undefined}
              startMonth={min ? toDate(min) : undefined}
              onSelect={(date) => {
                if (!date) return;
                onChange(toIso(date));
                setOpen(false);
              }}
            />
            {clearable && value ? (
              <div className="border-line mt-2 flex justify-end border-t pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  Clear date
                </Button>
              </div>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  },
);
DatePicker.displayName = "DatePicker";

export { DatePicker };

"use client";

import { forwardRef, useMemo } from "react";

import { Select } from "./Select";

/*
 * TimePicker: Radix has no time picker, so this is shadcn's usual answer, a
 * Select of times, every `step` minutes through the day. Values and labels
 * are the app's 24-hour "HH:MM" wall-clock strings. A saved time that is off
 * the step (09:10) is kept as an option, so it still shows and can be kept.
 */

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Minutes between options. */
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

function times(step: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return Array.from({ length: Math.ceil((24 * 60) / step) }, (_, i) => {
    const minutes = i * step;
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  });
}

const TimePicker = forwardRef<HTMLButtonElement, TimePickerProps>(
  (
    { value, onChange, step = 15, placeholder = "Pick a time", ...props },
    ref,
  ) => {
    const options = useMemo(() => {
      const list = times(step);
      return value && !list.includes(value) ? [...list, value].sort() : list;
    }, [step, value]);

    return (
      <Select
        ref={ref}
        value={value}
        onValueChange={onChange}
        placeholder={placeholder}
        {...props}
      >
        {options.map((time) => (
          <Select.Item key={time} value={time}>
            {time}
          </Select.Item>
        ))}
      </Select>
    );
  },
);
TimePicker.displayName = "TimePicker";

export { TimePicker };

"use client";

import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/utils/cn";

import { useFieldContext } from "./Field";

// DESIGN.md input: white, hairline, 10px radius, 44px; focus is a deep-teal
// border plus a mint-tint ring, so the global focus outline is switched off.
export const controlClasses =
  "w-full rounded-chip border border-line bg-canvas px-3.5 text-[15px] text-ink transition-[border-color,box-shadow] duration-200 placeholder:text-muted focus:border-accent-ink focus:ring-3 focus:ring-accent-tint focus-visible:outline-none aria-invalid:border-danger aria-invalid:focus:ring-danger-soft disabled:cursor-not-allowed disabled:bg-surface disabled:text-faint";

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, id, ...props }, ref) => {
    const field = useFieldContext();
    return (
      <input
        ref={ref}
        id={id ?? field?.id}
        aria-invalid={field?.invalid ? true : undefined}
        aria-describedby={field?.describedBy}
        className={cn(controlClasses, "h-11", className)}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, id, rows = 3, ...props }, ref) => {
  const field = useFieldContext();
  return (
    <textarea
      ref={ref}
      id={id ?? field?.id}
      rows={rows}
      aria-invalid={field?.invalid ? true : undefined}
      aria-describedby={field?.describedBy}
      className={cn(controlClasses, "resize-y py-2.5 leading-normal", className)}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Input, Textarea };

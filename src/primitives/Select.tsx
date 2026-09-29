"use client";

import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import { forwardRef, type SelectHTMLAttributes } from "react";

import { cn } from "@/utils/cn";

import { useFieldContext } from "./Field";
import { controlClasses } from "./Input";

/** The native select (best on phones), dressed as a DESIGN.md input. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, id, children, ...props }, ref) => {
    const field = useFieldContext();
    return (
      <span className="relative block">
        <select
          ref={ref}
          id={id ?? field?.id}
          aria-invalid={field?.invalid ? true : undefined}
          aria-describedby={field?.describedBy}
          className={cn(controlClasses, "h-11 cursor-pointer appearance-none pr-10", className)}
          {...props}
        >
          {children}
        </select>
        <CaretDown
          aria-hidden="true"
          weight="bold"
          className="text-muted pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2"
        />
      </span>
    );
  },
);
Select.displayName = "Select";

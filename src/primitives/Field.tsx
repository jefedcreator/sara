"use client";

import { createContext, useContext, type ReactNode } from "react";

import { cn } from "@/utils/cn";

type FieldContextValue = {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/** Read by Input/Textarea so a field's label, hint and error wire up alone. */
export function useFieldContext() {
  return useContext(FieldContext);
}

interface FieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Label above the control, never placeholder-as-label (DESIGN.md). The error
 * sits under the field in danger text and replaces the hint.
 */
export function Field({ id, label, hint, error, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <FieldContext.Provider
      value={{ id, describedBy: errorId ?? hintId, invalid: Boolean(error) }}
    >
      <div className={cn("grid gap-1.5", className)}>
        <label htmlFor={id} className="text-ink-2 text-sm leading-[1.3] font-semibold">
          {label}
        </label>
        {children}
        {error ? (
          <p id={errorId} className="text-danger text-[13px] leading-snug">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-muted text-[13px] leading-snug">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

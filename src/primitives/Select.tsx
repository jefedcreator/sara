"use client";

import { CaretDown, CaretUp, Check } from "@phosphor-icons/react/dist/ssr";
import { Select as RadixSelect } from "radix-ui";
import { forwardRef, type ReactNode } from "react";

import { cn } from "@/utils/cn";

import { useFieldContext } from "./Field";
import { controlClasses } from "./Input";

/*
 * Select: shadcn's Radix Select, restyled to DESIGN.md. The trigger is a
 * DESIGN.md input (hairline, 10px radius, 44px, deep-teal focus ring) and the
 * list floats in the same card as the calendar popover. The picked option is
 * deep teal with a check. Items are `Select.Item`.
 *
 * Controlled only (`value` / `onValueChange`), so forms bind it through a
 * react-hook-form Controller. Radix reserves "" for "nothing picked", which
 * shows the placeholder.
 */

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  "aria-label"?: string;
  /** Classes for the trigger, e.g. a fixed width. */
  className?: string;
  children: ReactNode;
}

const SelectRoot = forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      value,
      onValueChange,
      placeholder,
      disabled,
      invalid,
      id,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const field = useFieldContext();
    return (
      <RadixSelect.Root
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <RadixSelect.Trigger
          ref={ref}
          id={id ?? field?.id}
          aria-label={props["aria-label"]}
          aria-invalid={(invalid ?? field?.invalid) ? true : undefined}
          aria-describedby={field?.describedBy}
          className={cn(
            controlClasses,
            "group/select flex h-11 cursor-pointer items-center justify-between gap-2 text-left",
            "data-placeholder:text-muted data-[state=open]:border-accent-ink data-[state=open]:ring-accent-tint aria-invalid:data-[state=open]:border-danger aria-invalid:data-[state=open]:ring-danger-soft data-[state=open]:ring-3",
            className,
          )}
        >
          <span className="min-w-0 truncate">
            <RadixSelect.Value placeholder={placeholder} />
          </span>
          <RadixSelect.Icon asChild>
            <CaretDown
              aria-hidden="true"
              weight="bold"
              className="text-muted ease-out-expo size-4 shrink-0 transition-transform duration-200 group-data-[state=open]/select:rotate-180"
            />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={8}
            collisionPadding={16}
            className={cn(
              "bg-canvas border-line rounded-card shadow-lift relative z-60 overflow-hidden border origin-(--radix-select-content-transform-origin)",
              "max-h-[min(var(--radix-select-content-available-height),18rem)] min-w-(--radix-select-trigger-width)",
              "data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in",
            )}
          >
            <RadixSelect.ScrollUpButton className={scrollButtonClasses}>
              <CaretUp weight="bold" className="size-3.5" />
            </RadixSelect.ScrollUpButton>
            <RadixSelect.Viewport className="p-1.5 overscroll-contain">
              {children}
            </RadixSelect.Viewport>
            <RadixSelect.ScrollDownButton className={scrollButtonClasses}>
              <CaretDown weight="bold" className="size-3.5" />
            </RadixSelect.ScrollDownButton>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    );
  },
);
SelectRoot.displayName = "Select";

const scrollButtonClasses =
  "text-muted flex h-7 cursor-default items-center justify-center";

function SelectItem({
  value,
  disabled,
  meta,
  children,
}: {
  value: string;
  disabled?: boolean;
  /** A quieter second line (price, stock). Not shown in the closed trigger. */
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RadixSelect.Item
      value={value}
      disabled={disabled}
      className={cn(
        "rounded-chip text-ink relative flex cursor-pointer items-center gap-2 pr-9 pl-3 text-[15px] outline-none select-none",
        meta ? "min-h-12 py-1.5" : "h-10",
        "data-highlighted:bg-surface data-[state=checked]:text-accent-ink data-[state=checked]:font-semibold",
        "data-disabled:text-faint data-disabled:cursor-not-allowed",
      )}
    >
      <span className="grid min-w-0">
        <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
        {meta ? <span className="text-muted text-[13px]">{meta}</span> : null}
      </span>
      <RadixSelect.ItemIndicator className="absolute right-3 inline-flex">
        <Check weight="bold" className="text-accent-ink size-4" />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
}

/** A titled run of items, e.g. "Products" after the services. */
function SelectGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <RadixSelect.Group className="border-line mt-1 border-t pt-1 first:mt-0 first:border-t-0 first:pt-0">
      <RadixSelect.Label className="text-muted px-3 pt-2 pb-1 text-[13px] font-semibold">
        {label}
      </RadixSelect.Label>
      {children}
    </RadixSelect.Group>
  );
}

export const Select = Object.assign(SelectRoot, {
  Item: SelectItem,
  Group: SelectGroup,
});

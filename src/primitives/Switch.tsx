"use client";

import { Switch as RadixSwitch } from "radix-ui";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "@/utils/cn";

/** On is a green fill (an owner choice); the thumb is always white. */
export const Switch = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof RadixSwitch.Root>
>(({ className, ...props }, ref) => (
  <RadixSwitch.Root
    ref={ref}
    className={cn(
      "bg-line data-[state=checked]:bg-accent relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    {...props}
  >
    <RadixSwitch.Thumb className="bg-canvas shadow-bubble ease-out-expo block size-6 rounded-full transition-transform duration-200 data-[state=checked]:translate-x-5" />
  </RadixSwitch.Root>
));
Switch.displayName = "Switch";

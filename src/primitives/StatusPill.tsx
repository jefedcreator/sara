import type { ReactNode } from "react";

import { cn } from "@/utils/cn";

type Tone = "accent" | "muted" | "danger";

const TONES: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent-ink",
  muted: "bg-surface text-muted",
  danger: "bg-danger-soft text-danger",
};

/** Literal product states: "Live", "Paused", "Paid". Sentence case, never caps. */
export function StatusPill({
  tone = "accent",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1.5 text-[13px] leading-none font-semibold whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

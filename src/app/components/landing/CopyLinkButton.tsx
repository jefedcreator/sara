"use client";

import { useCallback, useRef, useState } from "react";

import { cn } from "@/utils/cn";

type State = "idle" | "copied" | "failed";

const LABEL: Record<State, string> = {
  idle: "Copy",
  copied: "Copied",
  failed: "Press and hold to copy",
};

const IDLE = {
  dark: "bg-ink text-canvas hover:bg-accent-ink",
  quiet: "border border-line bg-canvas text-ink hover:border-ink",
} as const;

export function CopyLinkButton({
  url,
  label = "Copy",
  tone = "dark",
  className,
}: {
  url: string;
  /** The resting label; "Copied" and the fallback hint replace it briefly. */
  label?: string;
  /** "quiet" for rows where it sits beside other actions. */
  tone?: keyof typeof IDLE;
  className?: string;
}) {
  const [state, setState] = useState<State>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimer = useCallback(() => {
    if (!resetTimerRef.current) return;
    clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }, []);

  const queueReset = useCallback(() => {
    clearResetTimer();
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      setState("idle");
    }, 2200);
  }, [clearResetTimer]);

  const buttonRef = useCallback(
    (node: HTMLButtonElement | null) => {
      if (!node) clearResetTimer();
    },
    [clearResetTimer],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    queueReset();
  };

  return (
    <button
      ref={buttonRef}
      className={cn(
        "ease-out-expo h-[38px] flex-none cursor-pointer rounded-full px-[18px] text-sm font-semibold transition-[background-color,border-color,scale] duration-200 active:scale-97",
        state === "idle" ? IDLE[tone] : "bg-accent text-on-accent",
        className,
      )}
      type="button"
      aria-live="polite"
      onClick={() => void copy()}
    >
      {state === "idle" ? label : LABEL[state]}
    </button>
  );
}

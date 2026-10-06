"use client";

import { useCallback, useRef, useState } from "react";

import { cn } from "@/utils/cn";

type State = "idle" | "copied" | "failed";

const LABEL: Record<State, string> = {
  idle: "Copy",
  copied: "Copied",
  failed: "Press and hold to copy",
};

export function CopyLinkButton({ url }: { url: string }) {
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
        "ease-out-expo h-[38px] flex-none cursor-pointer rounded-full px-[18px] text-sm font-semibold transition-[background-color,scale] duration-200 active:scale-97",
        state === "idle"
          ? "bg-ink text-canvas hover:bg-accent-ink"
          : "bg-accent text-on-accent",
      )}
      type="button"
      aria-live="polite"
      onClick={() => void copy()}
    >
      {LABEL[state]}
    </button>
  );
}

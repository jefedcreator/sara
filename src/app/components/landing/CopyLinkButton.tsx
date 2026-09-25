"use client";

import { useEffect, useState } from "react";

import { cn } from "@/utils/cn";

type State = "idle" | "copied" | "failed";

const LABEL: Record<State, string> = {
  idle: "Copy",
  copied: "Copied",
  failed: "Press and hold to copy",
};

export function CopyLinkButton({ url }: { url: string }) {
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2200);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <button
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

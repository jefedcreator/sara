"use client";

import { Check, LinkSimple, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/primitives";
import { cn } from "@/utils/cn";

type State = "idle" | "copied" | "failed";

const STATUS: Record<State, string> = {
  idle: "",
  copied: "Link copied",
  failed: "Couldn't copy the link",
};

/**
 * Copies a customer's page link from a list row. An icon, not a label: a
 * row's words belong to its next step (Record payment, Mark done), and the
 * link is a utility beside them. The icon turns into a check on green for a
 * moment; because an icon swap is silent, a status line says it too. The
 * accessible name stays the action ("Copy link to INV-1012").
 */
export function CopyLinkIconButton({ url, label }: { url: string; label: string }) {
  const [state, setState] = useState<State>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimer = useCallback(() => {
    if (!resetTimerRef.current) return;
    clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }, []);

  // Clears a pending reset when the row unmounts (a page change, a refetch).
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
    clearResetTimer();
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      setState("idle");
    }, 2200);
  };

  return (
    <>
      <Button
        ref={buttonRef}
        variant="secondary"
        size="icon"
        aria-label={label}
        title={label}
        onClick={() => void copy()}
        className={cn(
          state === "copied" && "bg-accent text-on-accent hover:bg-accent border-transparent hover:border-transparent",
          state === "failed" && "text-danger",
        )}
      >
        {state === "copied" ? (
          <Check weight="bold" aria-hidden="true" />
        ) : state === "failed" ? (
          <WarningCircle weight="bold" aria-hidden="true" />
        ) : (
          <LinkSimple weight="bold" aria-hidden="true" />
        )}
      </Button>
      <span role="status" className="sr-only">
        {STATUS[state]}
      </span>
    </>
  );
}

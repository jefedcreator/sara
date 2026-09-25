"use client";

import { useEffect, useState } from "react";

import s from "./landing.module.css";

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
      className={`${s.copy} ${state !== "idle" ? s.copyDone : ""}`}
      type="button"
      aria-live="polite"
      onClick={() => void copy()}
    >
      {LABEL[state]}
    </button>
  );
}

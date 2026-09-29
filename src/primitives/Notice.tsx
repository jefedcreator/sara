import type { ReactNode } from "react";

import { cn } from "@/utils/cn";

/** An inline message: info on mint, errors on danger wash. */
export function Notice({
  tone = "info",
  className,
  children,
}: {
  tone?: "info" | "danger" | "neutral";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-card px-4 py-3 text-[15px] leading-normal text-pretty",
        tone === "info" && "bg-accent-soft text-accent-ink",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "neutral" && "bg-surface text-ink-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

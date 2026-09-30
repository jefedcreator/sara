import { cn } from "@/utils/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("bg-surface rounded-chip block animate-pulse", className)}
    />
  );
}

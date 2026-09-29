import { cn } from "@/utils/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("bg-surface block animate-pulse rounded-chip", className)}
    />
  );
}

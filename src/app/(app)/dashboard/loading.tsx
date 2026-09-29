import { Skeleton } from "@/primitives";

/** The page body only: the chrome is the layout's and stays standing. */
export default function DashboardLoading() {
  return (
    <div className="grid gap-8" aria-busy="true" aria-label="Loading today">
      <div>
        <Skeleton className="h-10 w-32" />
        <Skeleton className="mt-3 h-4 w-44" />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="rounded-card h-[60px]" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="rounded-card h-[104px]" />
        ))}
      </div>
      <div className="grid gap-4 min-[1040px]:grid-cols-2">
        <Skeleton className="rounded-panel h-[260px]" />
        <Skeleton className="rounded-panel h-[260px]" />
      </div>
    </div>
  );
}

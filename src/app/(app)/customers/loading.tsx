import { Skeleton } from "@/primitives";

/** The page body only: the chrome is the layout's and stays standing. */
export default function CustomersLoading() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading customers">
      <div>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-3 h-4 w-full max-w-[420px]" />
      </div>
      <Skeleton className="rounded-chip h-11 w-full max-w-[520px]" />
      <div className="grid gap-2.5">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="rounded-card h-[68px]" />
        ))}
      </div>
    </div>
  );
}

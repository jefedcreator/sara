import { Skeleton } from "@/primitives";

/** The page body only: the chrome is the layout's and stays standing. */
export default function BookingsLoading() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading bookings">
      <div>
        <Skeleton className="h-10 w-44" />
        <Skeleton className="mt-3 h-4 w-full max-w-[420px]" />
      </div>
      <Skeleton className="h-10 w-full max-w-[520px] rounded-full" />
      <div className="grid gap-2.5">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="rounded-card h-[92px]" />
        ))}
      </div>
    </div>
  );
}

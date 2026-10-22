import { Skeleton } from "@/primitives";

/** The page body only: the chrome is the layout's and stays standing. */
export default function CustomerLoading() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading customer">
      <div>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-10 w-56" />
        <Skeleton className="mt-3 h-4 w-full max-w-[320px]" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="rounded-panel h-[104px]" />
        ))}
      </div>
      <div className="grid gap-2.5">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="rounded-card h-[68px]" />
        ))}
      </div>
    </div>
  );
}

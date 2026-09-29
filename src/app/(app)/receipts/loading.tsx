import { Skeleton } from "@/primitives";

/** The page body only: the chrome is the layout's and stays standing. */
export default function ReceiptsLoading() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading receipts">
      <div>
        <Skeleton className="h-10 w-40" />
        <Skeleton className="mt-3 h-4 w-full max-w-[420px]" />
      </div>
      <div className="grid gap-2.5">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="rounded-card h-[76px]" />
        ))}
      </div>
    </div>
  );
}

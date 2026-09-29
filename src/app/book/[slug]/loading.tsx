import { Skeleton } from "@/primitives";

/** The booking page's shape while the service and today's slots load. */
export default function BookingLoading() {
  return (
    <main className="bg-canvas min-h-dvh" aria-busy="true" aria-label="Loading">
      <div className="max-w-page mx-auto px-4 md:px-8">
        <div className="flex h-16 items-center">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid gap-8 pt-4 lg:grid-cols-[1fr_460px] lg:gap-16 lg:pt-12">
          <div>
            <Skeleton className="h-11 w-4/5 max-w-[420px]" />
            <div className="mt-4 flex gap-2">
              <Skeleton className="h-7 w-28 rounded-full" />
              <Skeleton className="h-7 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-5 h-4 w-full max-w-[460px]" />
            <Skeleton className="mt-2 h-4 w-2/3 max-w-[320px]" />
          </div>
          <div>
            <Skeleton className="h-4 w-24" />
            <div className="mt-2.5 flex gap-1.5">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-[52px] w-[58px] shrink-0 rounded-[14px]" />
              ))}
            </div>
            <Skeleton className="mt-6 h-4 w-48" />
            <div className="mt-2.5 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-[42px] rounded-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

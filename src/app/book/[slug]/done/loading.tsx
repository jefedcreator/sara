import { Skeleton } from "@/primitives";

/** The confirmation's shape while the booking is looked up. */
export default function BookingDoneLoading() {
  return (
    <main className="bg-canvas text-ink min-h-dvh px-4 pb-20 md:px-8" aria-busy="true" aria-label="Loading">
      <header className="max-w-page mx-auto flex h-16 items-center">
        <Skeleton className="h-5 w-24" />
      </header>
      <div className="mx-auto w-full max-w-[560px] pt-6 md:pt-14">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="mt-3.5 h-4 w-full max-w-[50ch]" />
        <Skeleton className="mt-2 h-4 w-1/2 max-w-[50ch]" />
        <Skeleton className="mt-8 h-11 w-40 rounded-full" />
      </div>
    </main>
  );
}

import { Skeleton } from "@/primitives";

/** The service page's shape while it loads. */
export default function ServiceLoading() {
  return (
    <main className="bg-canvas min-h-dvh" aria-busy="true" aria-label="Loading">
      <div className="max-w-page mx-auto px-4 md:px-8">
        <div className="flex h-16 items-center">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid gap-8 pt-4 lg:grid-cols-[1fr_460px] lg:gap-16 lg:pt-12">
          <Skeleton className="rounded-shot aspect-[16/10] lg:order-2 lg:aspect-[4/5]" />
          <div className="lg:order-1">
            <Skeleton className="h-11 w-4/5 max-w-[420px]" />
            <Skeleton className="mt-4 h-5 w-40" />
            <Skeleton className="mt-6 h-4 w-full max-w-[460px]" />
            <Skeleton className="mt-2 h-4 w-2/3 max-w-[320px]" />
          </div>
        </div>
      </div>
    </main>
  );
}

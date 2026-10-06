import { Skeleton } from "@/primitives";

/** A document or booking page's shape while it loads: pill, title, line, panel. */
export function PublicDetailSkeleton() {
  return (
    <main className="bg-canvas min-h-dvh" aria-busy="true" aria-label="Loading">
      <div className="mx-auto max-w-[640px] px-4 md:px-8">
        <div className="flex h-16 items-center">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="pt-4 lg:pt-12">
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="mt-4 h-11 w-4/5 max-w-[420px]" />
          <Skeleton className="mt-3 h-4 w-60" />
        </div>
        <Skeleton className="rounded-panel mt-8 h-[260px]" />
      </div>
    </main>
  );
}

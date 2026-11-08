import { Skeleton } from "@/primitives";

/** The sign-in page's shape while the session is read. */
export default function SignInLoading() {
  return (
    <main className="bg-canvas text-ink flex min-h-dvh items-center justify-center px-4 py-16 md:px-8" aria-busy="true" aria-label="Loading">
      <section className="max-w-page grid w-full gap-12 lg:grid-cols-[1fr_400px] lg:items-center lg:gap-20">
        <div className="max-w-2xl">
          <Skeleton className="mb-10 h-5 w-24" />
          <Skeleton className="h-12 w-full max-w-[520px]" />
          <Skeleton className="mt-3 h-12 w-3/4 max-w-[420px]" />
          <Skeleton className="mt-6 h-4 w-full max-w-[46ch]" />
          <Skeleton className="mt-2 h-4 w-2/3 max-w-[46ch]" />
        </div>
        <div className="rounded-panel bg-surface p-6 sm:p-8">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-3 h-4 w-56" />
          <div className="mt-5 space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-full" />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

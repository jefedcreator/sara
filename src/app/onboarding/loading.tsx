import { Skeleton } from "@/primitives";

/** The setup frame's shape while the session and business are read. */
export default function SetupLoading() {
  return (
    <main className="bg-canvas text-ink min-h-dvh px-4 pb-20 md:px-8" aria-busy="true" aria-label="Loading">
      <header className="max-w-page mx-auto flex h-16 items-center">
        <Skeleton className="h-5 w-24" />
      </header>
      <div className="mx-auto w-full max-w-[560px] pt-6 md:pt-14">
        <div className="flex gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-1.5 flex-1 rounded-full" />
          ))}
        </div>
        <Skeleton className="mt-8 h-10 w-4/5" />
        <Skeleton className="mt-3.5 h-4 w-full max-w-[50ch]" />
        <Skeleton className="mt-2 h-4 w-2/3 max-w-[50ch]" />
        <Skeleton className="mt-8 h-11 w-48 rounded-full" />
      </div>
    </main>
  );
}

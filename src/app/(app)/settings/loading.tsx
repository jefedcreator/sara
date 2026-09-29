import { Skeleton } from "@/primitives";

/** The page body only: the chrome is the layout's and stays standing. */
export default function SettingsLoading() {
  return (
    <div className="grid gap-8" aria-busy="true" aria-label="Loading settings">
      <div>
        <Skeleton className="h-10 w-44" />
        <Skeleton className="mt-3 h-4 w-full max-w-[380px]" />
      </div>
      <div className="grid gap-4 min-[1040px]:grid-cols-2">
        <Skeleton className="rounded-panel h-[520px]" />
        <Skeleton className="rounded-panel h-[520px]" />
      </div>
    </div>
  );
}

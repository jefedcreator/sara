import { DOCUMENT_GRID, DocumentCardSkeleton } from "@/components/documents/document-card";
import { Skeleton } from "@/primitives";

/** The page body only: the chrome is the layout's and stays standing. */
export default function InvoicesLoading() {
  return (
    <div className="grid grid-cols-1 gap-6" aria-busy="true" aria-label="Loading invoices">
      <div>
        <Skeleton className="h-10 w-40" />
        <Skeleton className="mt-3 h-4 w-full max-w-[420px]" />
      </div>
      <Skeleton className="h-10 w-full max-w-[400px] rounded-full" />
      <div className={DOCUMENT_GRID}>
        {Array.from({ length: 3 }, (_, i) => (
          <DocumentCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

import { FilePdf } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { Button, Skeleton, StatusPill } from "@/primitives";
import type { DocumentPreview } from "@/utils/document-preview";

import { DocumentPreviewFrame } from "./document-preview";

/**
 * The invoice and receipt lists: one column on phones, two from 700px, three
 * from 1040px, as the services grid. `grid-cols-1` is minmax(0, 1fr), so a
 * long name truncates instead of widening the page.
 */
export const DOCUMENT_GRID = "grid grid-cols-1 gap-4 min-[700px]:grid-cols-2 min-[1040px]:grid-cols-3";

/**
 * One invoice or receipt in the owner's list: the PDF's first page on top,
 * so the owner recognises the document before reading it; below, who and
 * how much, then the next step in words, utilities as icons, Void or Delete
 * last. Both lists use it, so an owner learns one shape.
 */
export function DocumentCard({
  preview,
  pdfUrl,
  title,
  status,
  meta,
  detail,
  amount,
  amountNote,
  actions,
}: {
  preview: DocumentPreview;
  pdfUrl: string | null;
  /** The customer's name. */
  title: string;
  /** The card's state ("Unpaid", "Paystack"), or null. */
  status: { label: string; tone: "accent" | "muted" | "danger" } | null;
  /** "INV-1012 · Due 12 Oct 2026": one dot, number first. */
  meta: string;
  /** What it was for, truncated to one line. */
  detail: string | null;
  amount: string;
  /** "NGN 22,000 left" under the amount. */
  amountNote?: string | null;
  actions: ReactNode;
}) {
  return (
    <article className="rounded-card bg-surface flex h-full flex-col overflow-hidden">
      <DocumentPreviewFrame preview={preview} pdfUrl={pdfUrl} />

      <div className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold">{title}</h3>
              {status ? (
                // Muted pills are leaf grey, the card's own ground: white keeps them visible.
                <StatusPill
                  tone={status.tone}
                  className={status.tone === "muted" ? "bg-canvas" : undefined}
                >
                  {status.label}
                </StatusPill>
              ) : null}
            </div>
            <p className="text-muted mt-0.5 text-sm">{meta}</p>
            {detail ? <p className="text-muted mt-0.5 truncate text-sm">{detail}</p> : null}
          </div>
          <p className="shrink-0 text-right">
            <span className="block text-[17px] font-semibold whitespace-nowrap">{amount}</span>
            {amountNote ? (
              <span className="text-muted block text-[13px] whitespace-nowrap">{amountNote}</span>
            ) : null}
          </p>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    </article>
  );
}

/** A card's shape while the list loads: the paper's frame, then its lines. */
export function DocumentCardSkeleton() {
  return (
    <div className="rounded-card bg-surface overflow-hidden" aria-hidden="true">
      <div className="border-line aspect-[16/10] border-b px-[9%] pt-[6%]">
        <Skeleton className="bg-canvas h-full rounded-t-[6px] rounded-b-none" />
      </div>
      <div className="grid gap-2 px-4 py-4 sm:px-5">
        <Skeleton className="bg-canvas h-4 w-2/5" />
        <Skeleton className="bg-canvas h-3.5 w-3/5" />
        <Skeleton className="bg-canvas mt-3 h-10 w-36 rounded-full" />
      </div>
    </div>
  );
}

/** A document's PDF from a card, in a new tab. */
export function PdfIconButton({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="secondary" size="icon">
      <a href={href} target="_blank" rel="noopener" aria-label={label} title={label}>
        <FilePdf weight="bold" aria-hidden="true" />
      </a>
    </Button>
  );
}

import { FilePdf } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { Button, StatusPill } from "@/primitives";

/**
 * One invoice or receipt in the owner's list. Who and what on the left; the
 * money at the right edge, so a list's figures line up in one column (top
 * right on phones, last on the line from `sm`); actions below on phones and
 * just before the money from `sm`. Rows read the same on both lists, so an
 * owner learns one shape.
 */
export function DocumentRow({
  title,
  status,
  meta,
  detail,
  amount,
  amountNote,
  actions,
}: {
  /** The customer's name. */
  title: string;
  /** The row's state ("Unpaid", "Paystack"), or null. */
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
    <article className="rounded-card bg-surface grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {status ? (
            // Muted pills are leaf grey, the row's own ground: white keeps them visible.
            <StatusPill tone={status.tone} className={status.tone === "muted" ? "bg-canvas" : undefined}>
              {status.label}
            </StatusPill>
          ) : null}
        </div>
        <p className="text-muted mt-0.5 text-sm">{meta}</p>
        {detail ? <p className="text-muted mt-0.5 truncate text-sm">{detail}</p> : null}
      </div>

      <p className="text-right sm:col-start-3 sm:row-start-1">
        <span className="block text-[17px] font-semibold whitespace-nowrap">{amount}</span>
        {amountNote ? (
          <span className="text-muted block text-[13px] whitespace-nowrap">{amountNote}</span>
        ) : null}
      </p>

      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:justify-end">
        {actions}
      </div>
    </article>
  );
}

/** A document's PDF from a list row, in a new tab. */
export function PdfIconButton({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="secondary" size="icon">
      <a href={href} target="_blank" rel="noopener" aria-label={label} title={label}>
        <FilePdf weight="bold" aria-hidden="true" />
      </a>
    </Button>
  );
}

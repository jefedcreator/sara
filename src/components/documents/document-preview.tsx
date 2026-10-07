import { Fragment } from "react";

import { StatusPill } from "@/primitives";
import { cn } from "@/utils/cn";
import type { DocumentPreview } from "@/utils/document-preview";
import { formatMoney } from "@/utils/format";

/*
 * The top of the PDF's first page, set to be read at a glance rather than
 * drawn to scale: the same blocks, labels and order as backend/services/pdf
 * (the business and the document, a rule, who it is for with the status,
 * then the items), in type from 11px up. A to-scale A4 page at card width
 * puts the body under 6px. The sheet is a size container, so a wider card
 * shows more of the page: the Price column from 320px, the dates and larger
 * type from 384px, the contact lines from 448px. The card's hairline cuts
 * the page off wherever it runs out of room.
 * Decorative: everything it shows is in the card's text below.
 */
function Sheet({ preview }: { preview: DocumentPreview }) {
  const money = (value: string) => formatMoney(value, preview.currency);
  const head = "border-line text-muted border-b pb-1 text-[11px] leading-tight";
  const cell = "border-line border-b py-1.5";
  const figure = "pl-3 text-right whitespace-nowrap";

  return (
    <div className="@container bg-canvas shadow-card ease-out-expo aspect-[595/842] rounded-t-[6px] transition-transform duration-300 group-hover:-translate-y-[3px]">
      <div className="px-4 pt-3.5 @sm:px-5 @sm:pt-5 @md:px-6 @md:pt-6">
        {/* Header: the business on the left, the document on the right. */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 pt-0.5">
            <p className="truncate text-[12px] leading-tight font-semibold @sm:text-[13px]">
              {preview.business.name}
            </p>
            <div className="text-muted mt-1 hidden text-[11px] leading-[1.45] @md:block">
              {preview.business.lines.map((line) => (
                <p key={line} className="truncate">
                  {line}
                </p>
              ))}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-display text-[18px] leading-none tracking-[-0.02em] @sm:text-[22px]">
              {preview.kind}
            </p>
            <p className="text-muted mt-1.5 font-mono text-[11px] leading-none">{preview.number}</p>
          </div>
        </div>

        <div className="border-line mt-2.5 border-t @sm:mt-3.5" />

        {/* Who it is for; the status with its dates. */}
        <div className="mt-2.5 flex items-start justify-between gap-3 @sm:mt-3.5">
          <div className="min-w-0">
            <p className="text-muted text-[11px] leading-tight">Billed to</p>
            <p className="font-display mt-1 truncate text-[16px] leading-tight font-medium tracking-[-0.02em] @sm:text-[18px]">
              {preview.client.name}
            </p>
            {preview.client.lines.map((line) => (
              <p
                key={line}
                className="text-muted mt-0.5 hidden truncate text-[11px] leading-snug @md:block"
              >
                {line}
              </p>
            ))}
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <StatusPill tone={preview.pill.tone} className="px-2.5 py-1 text-[11px]">
              {preview.pill.label}
            </StatusPill>
            <dl className="mt-2 hidden gap-1 text-[11px] leading-tight @sm:grid">
              {preview.meta.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-muted">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* The items, as far down the page as the card reaches. */}
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] text-[12px] leading-snug @xs:grid-cols-[minmax(0,1fr)_auto_auto_auto] @sm:mt-4 @sm:text-[13px]">
          <span className={head}>Item</span>
          <span className={cn(head, figure)}>Qty</span>
          <span className={cn(head, figure, "hidden @xs:block")}>Price</span>
          <span className={cn(head, figure)}>Amount</span>
          {preview.items.map((item, i) => (
            <Fragment key={i}>
              <span className={cn(cell, "truncate")}>{item.description}</span>
              <span className={cn(cell, figure)}>{item.quantity}</span>
              <span className={cn(cell, figure, "hidden @xs:block")}>{money(item.unitPrice)}</span>
              <span className={cn(cell, figure)}>{money(item.total)}</span>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The top of a document card: the PDF's first page as a sheet of paper on
 * leaf grey, cut off by the card's hairline like a page half out of its
 * folder. With a PDF, the sheet opens it (mouse and touch; keyboard and
 * screen readers use the card's PDF button, so this link stays out of the
 * tab order). Lifts a little on hover to say so.
 */
export function DocumentPreviewFrame({
  preview,
  pdfUrl,
}: {
  preview: DocumentPreview;
  pdfUrl: string | null;
}) {
  const frame = "border-line relative block aspect-[16/10] overflow-hidden border-b px-[6%] pt-[5%]";
  const sheet = <Sheet preview={preview} />;

  return pdfUrl ? (
    <a
      href={pdfUrl}
      target="_blank"
      rel="noopener"
      tabIndex={-1}
      aria-hidden="true"
      className={cn(frame, "group cursor-pointer")}
    >
      {sheet}
    </a>
  ) : (
    <div className={frame} aria-hidden="true">
      {sheet}
    </div>
  );
}

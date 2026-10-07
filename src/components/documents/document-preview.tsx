import { cn } from "@/utils/cn";
import type { DocumentPreview } from "@/utils/document-preview";
import { formatMoney } from "@/utils/format";

const PILL = {
  accent: "bg-accent-soft text-accent-ink",
  muted: "bg-surface text-muted",
  danger: "bg-danger-soft text-danger",
} as const;

/*
 * The PDF's first page, drawn small: the same blocks, labels and type as
 * backend/services/pdf, at the PDF's proportions. The sheet is a size
 * container, so every length is in cqw of its width, converted from the
 * PDF's points (595.28pt wide: 1pt = 0.168cqw). Margins 48pt, body 10.5pt,
 * title 26pt, customer 22pt; the item columns end where the PDF's do.
 * The margins sit on an inner box: cqw on the container itself resolves
 * against the viewport, and its padding would shrink the page's 100cqw.
 * Decorative: everything it shows is in the card's text below.
 */
function Sheet({ preview }: { preview: DocumentPreview }) {
  const money = (value: string) => formatMoney(value, preview.currency);
  const columns = "grid grid-cols-[1fr_8.8%_18.8%_19.4%] gap-x-[1.5cqw]";

  return (
    <div className="@container bg-canvas shadow-card ease-out-expo aspect-[595/842] rounded-t-[6px] transition-transform duration-300 group-hover:-translate-y-[3px]">
      <div className="px-[8.06cqw] pt-[8.06cqw]">
        {/* Header: the business on the left, the document on the right. */}
        <div className="flex items-start justify-between gap-[3cqw]">
          <div className="min-w-0">
            <p className="truncate pt-[1cqw] text-[2.69cqw] leading-tight font-semibold">
              {preview.business.name}
            </p>
            <div className="text-muted mt-[1.2cqw] text-[1.6cqw] leading-[1.42]">
              {preview.business.lines.map((line) => (
                <p key={line} className="truncate">
                  {line}
                </p>
              ))}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-display text-[4.37cqw] leading-none">{preview.kind}</p>
            <p className="text-faint mt-[1.3cqw] font-mono text-[1.68cqw]">{preview.number}</p>
          </div>
        </div>

        <div className="border-line mt-[2.35cqw] border-t" />

        {/* Who it is for; the status with its dates. */}
        <div className="mt-[4.4cqw] grid grid-cols-[1fr_41.5%] gap-x-[3cqw]">
          <div className="min-w-0">
            <p className="text-muted text-[1.51cqw]">Billed to</p>
            <p className="font-display mt-[1.7cqw] line-clamp-2 text-[3.7cqw] leading-[1.18]">
              {preview.client.name}
            </p>
            {preview.client.lines.map((line) => (
              <p key={line} className="text-muted mt-[0.5cqw] truncate text-[1.68cqw]">
                {line}
              </p>
            ))}
          </div>
          <div>
            <p
              className={cn(
                "ml-auto w-fit rounded-full px-[1.85cqw] py-[0.6cqw] text-[1.6cqw] leading-tight font-semibold",
                PILL[preview.pill.tone],
              )}
            >
              {preview.pill.label}
            </p>
            <dl className="mt-[2.6cqw] grid gap-[1.3cqw] text-[1.68cqw]">
              {preview.meta.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-[1cqw]">
                  <dt className="text-muted">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* The item table, as far as the top of the page reaches. */}
        <div className="mt-[4.4cqw]">
          <div className={cn(columns, "border-line text-muted border-b pb-[1.7cqw] text-[1.51cqw]")}>
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Price</span>
            <span className="text-right">Amount</span>
          </div>
          {preview.items.map((item, i) => (
            <div
              key={i}
              className={cn(columns, "border-line border-b py-[1.7cqw] text-[1.76cqw] leading-snug")}
            >
              <span className="truncate">{item.description}</span>
              <span className="text-right">{item.quantity}</span>
              <span className="truncate text-right">{money(item.unitPrice)}</span>
              <span className="truncate text-right">{money(item.total)}</span>
            </div>
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
  const frame = "border-line relative block aspect-[16/10] overflow-hidden border-b px-[9%] pt-[6%]";
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

import { Fragment, type ReactNode } from "react";

import { PublicPage } from "@/components/public/public-page";
import { Button, StatusPill } from "@/primitives";
import { cn } from "@/utils/cn";
import { formatMoney } from "@/utils/format";
import { formatDate } from "@/utils/labels";
import {
  documentLead,
  documentLines,
  documentTitle,
  type SharedDocument,
} from "@/utils/shared-document";

function Row({
  label,
  strong,
  children,
}: {
  label: string;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4",
        strong && "font-semibold",
      )}
    >
      <dt className={strong ? undefined : "text-muted"}>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * The page behind a customer's invoice or receipt link: the business, the
 * document's state, then the document itself as a sheet, led by what the
 * customer came for (what's owed, or what was paid), and the PDF. Laid out
 * like the booking page, whose customers these are too.
 */
export function SharedDocumentPage({ doc }: { doc: SharedDocument }) {
  const noun = doc.kind === "invoice" ? "Invoice" : "Receipt";
  const money = (amount: number) => formatMoney(amount, doc.currency);
  const lines = documentLines(doc);
  const lead = documentLead(doc);
  const adjusted = doc.taxAmount > 0 || doc.discount > 0;

  const when =
    doc.kind === "invoice"
      ? [
          `Issued ${formatDate(doc.issuedAt)}`,
          doc.dueAt ? `Due ${formatDate(doc.dueAt)}` : null,
        ]
      : [`Paid ${formatDate(doc.issuedAt)}`, doc.paymentMethod];

  return (
    <PublicPage businessName={doc.businessName} credit={`${noun}s`}>
      <section
        aria-labelledby="document-h"
        className="animate-rise pt-4 lg:pt-12"
      >
        <StatusPill tone={doc.status.tone}>{doc.status.label}</StatusPill>
        <h1
          id="document-h"
          className="font-display mt-4 text-[clamp(2.1rem,1.4rem+3vw,3.4rem)] leading-[1.04] font-[380] tracking-[-0.035em] text-balance"
        >
          {documentTitle(doc)}
        </h1>
        <p className="text-muted mt-3 text-pretty">
          {doc.customerName ? `For ${doc.customerName}. ` : null}
          {/* Each date stays whole: the line breaks between them, never inside "12 Oct 2026". */}
          {when
            .filter((part): part is string => Boolean(part))
            .map((part, i) => (
              <Fragment key={part}>
                {i > 0 ? " · " : null}
                <span className="whitespace-nowrap">{part}</span>
              </Fragment>
            ))}
        </p>
      </section>

      {/* The document itself: a white sheet with a hairline and the Card shadow DESIGN.md keeps for invoices. */}
      <section
        aria-label={`${noun} details`}
        className="rounded-card border-line bg-canvas shadow-card animate-rise-2 mt-8 border px-5 py-6 sm:px-8 sm:py-8"
      >
        <p className="text-muted text-sm font-semibold">{lead.label}</p>
        <p className="font-display mt-1.5 text-[clamp(2.2rem,1.8rem+1.6vw,3rem)] leading-none font-[330] tracking-[-0.035em]">
          {money(lead.amount)}
        </p>

        <ul className="border-line mt-6 space-y-3 border-t pt-5 text-[15px]">
          {lines.map((line, i) => (
            <li key={i} className="flex items-baseline justify-between gap-4">
              <span className="min-w-0">
                <span className="block whitespace-pre-line">{line.description}</span>
                {line.quantity > 1 ? (
                  <span className="text-muted mt-0.5 block text-sm">
                    {line.quantity} × {money(line.unitPrice)}
                  </span>
                ) : null}
              </span>
              <span className="text-ink-2 shrink-0">{money(line.total)}</span>
            </li>
          ))}
        </ul>

        <dl className="border-line mt-5 space-y-2 border-t pt-5 text-[15px]">
          {adjusted ? (
            <Row label="Subtotal">{money(doc.subtotal)}</Row>
          ) : null}
          {doc.taxAmount > 0 ? (
            <Row label="Tax">{money(doc.taxAmount)}</Row>
          ) : null}
          {doc.discount > 0 ? (
            <Row label="Discount">−{money(doc.discount)}</Row>
          ) : null}
          <Row label="Total" strong>
            {money(doc.total)}
          </Row>
          {doc.kind === "invoice" && doc.amountPaid > 0 ? (
            <Row label="Paid">{money(doc.amountPaid)}</Row>
          ) : null}
          {doc.balance > 0 ? (
            <Row label="Balance due" strong>
              {money(doc.balance)}
            </Row>
          ) : null}
        </dl>

        {/* The business's note is part of the document; without lines it already stands in for them. */}
        {doc.notes && doc.lines.length > 0 ? (
          <p className="border-line text-muted mt-5 border-t pt-5 text-[15px] text-pretty whitespace-pre-line">
            {doc.notes}
          </p>
        ) : null}
      </section>

      {doc.pdfUrl ? (
        <Button
          asChild
          size="lg"
          className="animate-rise-3 mt-8 w-full sm:w-auto"
        >
          <a href={doc.pdfUrl} target="_blank" rel="noopener">
            Download PDF
          </a>
        </Button>
      ) : null}
    </PublicPage>
  );
}

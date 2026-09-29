import type { InvoiceDto } from "types";

import { Button, StatusPill } from "@/primitives";
import { formatMoney } from "@/utils/format";
import { formatDate, INVOICE_STATUS } from "@/utils/labels";

import { outstandingOf } from "./payment-modal";

interface InvoiceRowProps {
  invoice: InvoiceDto;
  busy: boolean;
  onRecordPayment: () => void;
  onSend: () => void;
  onVoid: () => void;
  onDelete: () => void;
}

/** One invoice and what can happen to it next, by status. */
export function InvoiceRow({ invoice, busy, onRecordPayment, onSend, onVoid, onDelete }: InvoiceRowProps) {
  const status = INVOICE_STATUS[invoice.status];
  const outstanding = outstandingOf(invoice);
  const takesPayment = ["SENT", "OVERDUE", "PARTIALLY_PAID"].includes(invoice.status);
  const lines = invoice.services.map((line) => line.service.name).join(", ");

  return (
    <article className="rounded-card bg-surface grid gap-4 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-center sm:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold">{invoice.clientName}</h3>
          {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
        </div>
        <p className="text-muted mt-0.5 text-sm">
          {invoice.invoiceNumber} · {formatDate(invoice.createdAt)}
          {invoice.dueAt ? ` · due ${formatDate(invoice.dueAt)}` : ""}
        </p>
        {lines || invoice.notes ? (
          <p className="text-muted mt-0.5 truncate text-sm">{lines || invoice.notes}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <p className="mr-2 text-right">
          <span className="block text-[17px] font-semibold whitespace-nowrap">
            {formatMoney(invoice.total, invoice.currency)}
          </span>
          {invoice.status === "PARTIALLY_PAID" ? (
            <span className="text-muted block text-[13px] whitespace-nowrap">
              {formatMoney(outstanding, invoice.currency)} left
            </span>
          ) : null}
        </p>
        {takesPayment ? (
          <Button size="sm" variant="dark" onClick={onRecordPayment} disabled={busy}>
            Record payment
          </Button>
        ) : null}
        {invoice.status === "DRAFT" ? (
          <Button size="sm" variant="dark" onClick={onSend} isLoading={busy}>
            Mark as sent
          </Button>
        ) : null}
        {invoice.url ? (
          <Button asChild size="sm" variant="secondary">
            <a href={invoice.url} target="_blank" rel="noopener">
              PDF
            </a>
          </Button>
        ) : null}
        {invoice.status === "SENT" || invoice.status === "OVERDUE" ? (
          <Button size="sm" variant="ghost" onClick={onVoid} disabled={busy}>
            Void
          </Button>
        ) : null}
        {invoice.status === "DRAFT" || invoice.status === "VOID" ? (
          <Button size="sm" variant="ghost" onClick={onDelete} disabled={busy}>
            Delete
          </Button>
        ) : null}
      </div>
    </article>
  );
}

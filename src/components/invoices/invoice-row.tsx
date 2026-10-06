import type { InvoiceDto } from "types";

import { CopyLinkIconButton } from "@/components/copy-link-icon-button";
import { DocumentRow, PdfIconButton } from "@/components/documents/document-row";
import { Button } from "@/primitives";
import { formatMoney } from "@/utils/format";
import { formatDate, INVOICE_STATUS } from "@/utils/labels";

import { outstandingOf } from "./payment-modal";

interface InvoiceRowProps {
  invoice: InvoiceDto;
  /** The customer's invoice page. */
  link: string;
  busy: boolean;
  onRecordPayment: () => void;
  onSend: () => void;
  onVoid: () => void;
  onDelete: () => void;
}

/**
 * One invoice and what can happen to it next, by status: the next step in
 * words, the link and the PDF as icons beside it, Void or Delete last.
 */
export function InvoiceRow({
  invoice,
  link,
  busy,
  onRecordPayment,
  onSend,
  onVoid,
  onDelete,
}: InvoiceRowProps) {
  const status = INVOICE_STATUS[invoice.status];
  const outstanding = outstandingOf(invoice);
  const takesPayment = ["SENT", "OVERDUE", "PARTIALLY_PAID"].includes(invoice.status);
  const lines = invoice.services.map((line) => line.service.name).join(", ");
  // The date that matters next: when it's due, or, with no due date, when it was made.
  const when = invoice.dueAt ? `Due ${formatDate(invoice.dueAt)}` : formatDate(invoice.createdAt);

  return (
    <DocumentRow
      title={invoice.clientName}
      status={status ?? null}
      meta={`${invoice.invoiceNumber} · ${when}`}
      detail={lines || invoice.notes}
      amount={formatMoney(invoice.total, invoice.currency)}
      amountNote={
        invoice.status === "PARTIALLY_PAID"
          ? `${formatMoney(outstanding, invoice.currency)} left`
          : null
      }
      actions={
        <>
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
          <CopyLinkIconButton url={link} label={`Copy link to ${invoice.invoiceNumber}`} />
          {invoice.url ? (
            <PdfIconButton href={invoice.url} label={`PDF of ${invoice.invoiceNumber}`} />
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
        </>
      }
    />
  );
}

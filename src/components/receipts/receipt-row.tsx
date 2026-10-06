import type { ReceiptDto } from "types";

import { CopyLinkIconButton } from "@/components/copy-link-icon-button";
import { DocumentRow, PdfIconButton } from "@/components/documents/document-row";
import { formatMoney } from "@/utils/format";
import { formatDate, PAYMENT_METHOD } from "@/utils/labels";

/**
 * One receipt: who paid, how, and what for, with the amount where the
 * invoice rows keep theirs. Nothing happens to a receipt next, so its only
 * actions are the link and the PDF.
 */
export function ReceiptRow({ receipt, link }: { receipt: ReceiptDto; link: string }) {
  const invoice = receipt.payment?.invoice;
  const method = receipt.paymentMethod ? PAYMENT_METHOD[receipt.paymentMethod] : null;
  const lines = receipt.services.map((line) => line.service.name).join(", ");

  return (
    <DocumentRow
      title={receipt.name ?? "Customer"}
      status={method ? { label: method, tone: "muted" } : null}
      meta={`${receipt.receiptNumber} · ${formatDate(receipt.createdAt)}`}
      detail={invoice ? `Payment for ${invoice.invoiceNumber}` : lines || receipt.notes}
      amount={formatMoney(receipt.amountPaid, receipt.currency)}
      actions={
        <>
          <CopyLinkIconButton url={link} label={`Copy link to ${receipt.receiptNumber}`} />
          {receipt.url ? (
            <PdfIconButton href={receipt.url} label={`PDF of ${receipt.receiptNumber}`} />
          ) : null}
        </>
      }
    />
  );
}

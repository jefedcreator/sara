import type { ReceiptDto } from "types";

import { CopyLinkIconButton } from "@/components/copy-link-icon-button";
import { DocumentCard, PdfIconButton } from "@/components/documents/document-card";
import { Button } from "@/primitives";
import { receiptPreview } from "@/utils/document-preview";
import { formatMoney } from "@/utils/format";
import { formatDate, PAYMENT_METHOD } from "@/utils/labels";

interface ReceiptRowProps {
  receipt: ReceiptDto;
  link: string;
  onEdit?: () => void;
}

/**
 * One receipt as a card: its PDF's first page, then who paid, how, and what
 * for, with the amount where invoice cards keep theirs.
 */
export function ReceiptRow({ receipt, link, onEdit }: ReceiptRowProps) {
  const invoice = receipt.payment?.invoice;
  const method = receipt.paymentMethod ? PAYMENT_METHOD[receipt.paymentMethod] : null;
  const lines = receipt.services.map((line) => line.service.name).join(", ");
  const isEditable =
    !receipt.payment?.invoice &&
    (receipt.paymentMethod === "CASH" || receipt.paymentMethod === "BANK_TRANSFER");

  return (
    <DocumentCard
      preview={receiptPreview(receipt)}
      pdfUrl={receipt.url}
      title={receipt.name ?? "Customer"}
      status={method ? { label: method, tone: "muted" } : null}
      meta={`${receipt.receiptNumber} · ${formatDate(receipt.createdAt)}`}
      detail={invoice ? `Payment for ${invoice.invoiceNumber}` : lines || receipt.notes}
      amount={formatMoney(receipt.amountPaid, receipt.currency)}
      actions={
        <>
          {isEditable && onEdit ? (
            <Button size="sm" variant="ghost" onClick={onEdit}>
              Edit
            </Button>
          ) : null}
          <CopyLinkIconButton url={link} label={`Copy link to ${receipt.receiptNumber}`} />
          {receipt.url ? (
            <PdfIconButton href={receipt.url} label={`PDF of ${receipt.receiptNumber}`} />
          ) : null}
        </>
      }
    />
  );
}

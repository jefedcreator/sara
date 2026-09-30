import type { Metadata } from "next";

import { formatMoney } from "@/utils/format";
import { formatDate } from "@/utils/labels";
import { pageMetadata } from "@/utils/metadata";

/*
 * A customer's invoice or receipt as their share link shows it (read by
 * server/documents.ts). Pure, so the page, its metadata and its card share it.
 */

/**
 * What a customer's invoice or receipt link may show: the document as the
 * business issued it, and nothing about the business beyond its name.
 */
export type SharedDocument = {
  kind: "invoice" | "receipt";
  number: string;
  status: { label: string; tone: "accent" | "muted" | "danger" };
  /** A voided invoice: nothing is owed on it. */
  voided: boolean;
  businessName: string;
  customerName: string | null;
  currency: string;
  lines: { description: string; quantity: number; total: number }[];
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;
  amountPaid: number;
  /** Still owed: zero on a receipt, a paid invoice or a void one. */
  balance: number;
  /** When the invoice was sent (or made), or the receipt issued. */
  issuedAt: string;
  dueAt: string | null;
  paymentMethod: string | null;
  notes: string | null;
  pdfUrl: string | null;
};

/** "Invoice INV-1012" / "Receipt RCP-1007". */
export function documentTitle(doc: Pick<SharedDocument, "kind" | "number">) {
  return `${doc.kind === "invoice" ? "Invoice" : "Receipt"} ${doc.number}`;
}

/** The lines to show. A chat invoice has none; its note, or "Amount", stands in. */
export function documentLines(doc: SharedDocument) {
  if (doc.lines.length > 0) return doc.lines;
  // `||`: a blank note counts as none.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return [
    {
      description: doc.notes?.trim() || "Amount",
      quantity: 1,
      total: doc.subtotal,
    },
  ];
}

/**
 * The link preview text. Leads with what the customer needs from it: what's
 * left to pay and by when, or what they paid.
 */
export function documentMetadata(
  doc: SharedDocument | null,
  path: string,
): Metadata {
  if (!doc) {
    return pageMetadata({
      title: "Link not found · Sara",
      description:
        "This link is wrong or no longer works. Ask the business to send it again.",
      path,
      index: false,
    });
  }
  const money = (amount: number) => formatMoney(amount, doc.currency);
  let description: string;
  if (doc.kind === "receipt") {
    description = `${money(doc.amountPaid)} paid to ${doc.businessName} on ${formatDate(doc.issuedAt)}.`;
  } else if (doc.voided) {
    description = "This invoice was voided.";
  } else if (doc.balance > 0) {
    const due = doc.dueAt ? `, due ${formatDate(doc.dueAt)}` : "";
    description = `${money(doc.balance)} to pay${due}.`;
  } else {
    description = `${money(doc.total)}, paid in full.`;
  }
  return pageMetadata({
    title: `${documentTitle(doc)} from ${doc.businessName}`,
    description: `${description} See it here or download the PDF.`,
    path,
    index: false,
  });
}

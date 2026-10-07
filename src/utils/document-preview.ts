import type { InvoiceDto, ReceiptDto } from "types";

import { formatDate, INVOICE_STATUS, PAYMENT_METHOD } from "@/utils/labels";

/*
 * What the first page of an invoice or receipt PDF shows
 * (backend/services/pdf), read from an owner's list row so its card can draw
 * a miniature of the page. Same fields, labels and order as the PDF: when the
 * PDF's page changes, change this and components/documents/document-preview
 * with it. Pure and client-safe.
 */

export type DocumentPreview = {
  kind: "Invoice" | "Receipt";
  number: string;
  business: { name: string; lines: string[] };
  client: { name: string; lines: string[] };
  pill: { label: string; tone: "accent" | "muted" | "danger" };
  /** [label, value] pairs under the pill: "Issued", "Due", "Paid on"... */
  meta: [string, string][];
  currency: string;
  items: { description: string; quantity: number; unitPrice: string; total: string }[];
};

/** The lines the top half of the page has room for. */
export const PREVIEW_ITEMS = 4;

type Business = InvoiceDto["business"];
type Line = InvoiceDto["services"][number] | ReceiptDto["services"][number];

const present = (values: (string | null | undefined)[]) =>
  values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));

/** The business block: name, then email, phone and "City, State, Country". */
function businessOf(business: Business) {
  return {
    name: business.name,
    lines: present([
      business.email,
      business.phone,
      present([business.city, business.state, business.country]).join(", "),
    ]),
  };
}

function itemsOf(lines: Line[]) {
  return lines.slice(0, PREVIEW_ITEMS).map((line) => ({
    // `||`: an empty description falls back to the service's name, as on the PDF.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    description: line.description || line.service.name,
    quantity: line.quantity,
    unitPrice: String(line.unitPrice),
    total: String(line.total),
  }));
}

export function invoicePreview(invoice: InvoiceDto): DocumentPreview {
  const meta: [string, string][] = [["Issued", formatDate(invoice.sentAt ?? invoice.createdAt)]];
  if (invoice.dueAt) meta.push(["Due", formatDate(invoice.dueAt)]);
  if (invoice.paidAt) meta.push(["Paid", formatDate(invoice.paidAt)]);
  return {
    kind: "Invoice",
    number: invoice.invoiceNumber,
    business: businessOf(invoice.business),
    client: {
      name: invoice.clientName,
      lines: present([invoice.clientEmail, invoice.clientPhone]),
    },
    pill: INVOICE_STATUS[invoice.status] ?? { label: invoice.status, tone: "muted" },
    meta,
    currency: invoice.currency,
    items: itemsOf(invoice.services),
  };
}

export function receiptPreview(receipt: ReceiptDto): DocumentPreview {
  const meta: [string, string][] = [["Paid on", formatDate(receipt.createdAt)]];
  if (receipt.paymentMethod) {
    meta.push(["Paid by", PAYMENT_METHOD[receipt.paymentMethod] ?? receipt.paymentMethod]);
  }
  return {
    kind: "Receipt",
    number: receipt.receiptNumber,
    business: businessOf(receipt.business),
    client: {
      // `||`: a blank name reads as "Client", as on the PDF.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      name: receipt.name || "Client",
      lines: present([receipt.email, receipt.phone]),
    },
    pill: { label: "Paid", tone: "accent" },
    meta,
    currency: receipt.currency,
    items: itemsOf(receipt.services),
  };
}

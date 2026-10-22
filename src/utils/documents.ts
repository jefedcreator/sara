import {
  parseMoney,
  type DocumentFormSchema,
} from "@/backend/validators/document-form.validator";
import type { InvoiceDto, ReceiptDto } from "types";

import type { DocumentLineInput, ReceiptSaleInput } from "./api";

type Money = {
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;
};

/** Kobo-safe rounding to two places. */
function round(value: number) {
  return Math.round(value * 100) / 100;
}

/** The form's line items as the API wants them. Unparseable rows are skipped. */
export function toLineItems(
  values: Pick<DocumentFormSchema, "mode" | "items">,
): DocumentLineInput[] {
  if (values.mode !== "services") return [];
  return values.items.flatMap((item) => {
    const quantity = Number(item.quantity);
    const unitPrice = parseMoney(item.unitPrice);
    if ((!item.serviceId && !item.productOptionId && !item.name) || !(quantity >= 1) || Number.isNaN(unitPrice)) {
      return [];
    }
    return [
      {
        ...(item.serviceId ? { serviceId: item.serviceId } : {}),
        ...(item.productOptionId ? { productOptionId: item.productOptionId } : {}),
        ...(item.name ? { name: item.name } : {}),
        quantity,
        unitPrice,
        total: round(quantity * unitPrice),
      },
    ];
  });
}

/**
 * Subtotal, tax, discount and total for what's in the form right now. The
 * total never goes below zero. Used for the live summary and the payload, so
 * what the owner sees is what is saved.
 */
export function computeTotals(
  values: Pick<DocumentFormSchema, "mode" | "items" | "amount" | "taxAmount" | "discount">,
): Money {
  const subtotal =
    values.mode === "services"
      ? round(toLineItems(values).reduce((sum, item) => sum + item.total, 0))
      : round(parseMoney(values.amount) || 0);
  const taxAmount = round(parseMoney(values.taxAmount) || 0);
  const discount = round(parseMoney(values.discount) || 0);
  return {
    subtotal,
    taxAmount,
    discount,
    total: round(Math.max(0, subtotal + taxAmount - discount)),
  };
}

/** Whether the form has a product line (a row picked from the Products group). */
export function hasProductLine(values: {
  mode: DocumentFormSchema["mode"];
  items: { productOptionId?: string }[];
}) {
  return values.mode === "services" && values.items.some((item) => item.productOptionId);
}

/**
 * How a receipt's products are handed over. Only receipts with a product line
 * have one; otherwise there is nothing to deliver and nothing is sent.
 */
export function toSale(
  values: Pick<DocumentFormSchema, "mode" | "items" | "isDelivery" | "deliveryAddress">,
): ReceiptSaleInput | undefined {
  if (!hasProductLine(values)) return undefined;
  if (!values.isDelivery) return { fulfilment: "PICKUP" };
  // `||`: a blank address counts as none.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return { fulfilment: "DELIVERY", deliveryAddress: values.deliveryAddress?.trim() || null };
}

/** Customer, money and items: the part invoices and receipts share. */
export function toDocumentPayload(values: DocumentFormSchema, currency: string) {
  const lines = toLineItems(values);
  return {
    name: values.name,
    email: values.email || undefined,
    phone: values.phone || undefined,
    currency,
    ...computeTotals(values),
    notes: values.description || undefined,
    lines: lines.length > 0 ? lines : undefined,
  };
}

export function documentToFormValues(
  doc: InvoiceDto | ReceiptDto,
  kind: "invoice" | "receipt",
): DocumentFormSchema {
  const isInvoice = kind === "invoice";
  const inv = isInvoice ? (doc as InvoiceDto) : null;
  const rcp = !isInvoice ? (doc as ReceiptDto) : null;

  const name = isInvoice ? inv!.clientName : (rcp!.name ?? "");
  const email = isInvoice ? (inv!.clientEmail ?? "") : (rcp!.email ?? "");
  const phone = isInvoice ? (inv!.clientPhone ?? "") : (rcp!.phone ?? "");

  const hasLines = doc.lines && doc.lines.length > 0;
  const mode = hasLines ? "services" : "amount";

  const items = hasLines
    ? doc.lines.map((item) => ({
        serviceId: item.serviceId ?? "",
        ...(item.productOptionId ? { productOptionId: item.productOptionId } : {}),
        ...(item.serviceId ? {} : { name: item.name }),
        quantity: String(item.quantity),
        unitPrice: String(Number(item.unitPrice)),
      }))
    : [];

  const amount = !hasLines ? String(Number(doc.subtotal)) : "";
  const description = doc.notes ?? "";

  const taxAmount = Number(doc.taxAmount) > 0 ? String(Number(doc.taxAmount)) : "";
  const discount = Number(doc.discount) > 0 ? String(Number(doc.discount)) : "";

  let dueAt = "";
  if (isInvoice && inv?.dueAt) {
    dueAt = new Date(inv.dueAt).toISOString().split("T")[0] ?? "";
  }

  const paymentMethod = !isInvoice && rcp?.paymentMethod === "BANK_TRANSFER"
    ? "BANK_TRANSFER"
    : "CASH";

  return {
    name,
    email,
    phone,
    mode,
    items,
    amount,
    description,
    taxAmount,
    discount,
    dueAt,
    paymentMethod,
  };
}


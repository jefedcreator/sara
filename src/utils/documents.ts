import {
  parseMoney,
  type DocumentFormSchema,
} from "@/backend/validators/document-form.validator";

import type { LineItemInput } from "./api";

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
export function toLineItems(values: Pick<DocumentFormSchema, "mode" | "items">): LineItemInput[] {
  if (values.mode !== "services") return [];
  return values.items.flatMap((item) => {
    const quantity = Number(item.quantity);
    const unitPrice = parseMoney(item.unitPrice);
    if (!item.serviceId || !(quantity >= 1) || Number.isNaN(unitPrice)) return [];
    return [{ serviceId: item.serviceId, quantity, unitPrice, total: round(quantity * unitPrice) }];
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

/** Customer, money and items: the part invoices and receipts share. */
export function toDocumentPayload(values: DocumentFormSchema, currency: string) {
  const services = toLineItems(values);
  return {
    name: values.name,
    email: values.email || undefined,
    phone: values.phone || undefined,
    currency,
    ...computeTotals(values),
    notes: values.description || undefined,
    services: services.length > 0 ? services : undefined,
  };
}

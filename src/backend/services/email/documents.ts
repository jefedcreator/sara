import type { Invoice, Receipt } from "@prisma/client";

import { publicLink } from "@/server/share";
import { PAYMENT_METHOD } from "@/utils/labels";

import { emailService, type SendResult } from "./index";
import type { BusinessSender } from "./messages";

/*
 * Invoices and receipts go to the customer by email when the owner gave an
 * address, linking the document's page (server/share.ts), the same link
 * the chat and the owner's copy button hand out. Never throws (emailService).
 */

/** Sends a SENT invoice to its customer; skips drafts and invoices with no address. */
export async function emailInvoice(
  invoice: Invoice,
  business: BusinessSender,
): Promise<SendResult | null> {
  if (invoice.status !== "SENT" || !invoice.clientEmail) return null;
  return emailService.sendInvoiceEmail({
    to: invoice.clientEmail,
    business,
    customerName: invoice.clientName,
    number: invoice.invoiceNumber,
    total: invoice.total.toString(),
    amountPaid: invoice.amountPaid.toString(),
    currency: invoice.currency,
    dueAt: invoice.dueAt,
    url: publicLink("invoice", invoice.publicId),
  });
}

/** Sends a receipt to its customer; skips receipts with no address. */
export async function emailReceipt(
  receipt: Receipt,
  business: BusinessSender,
): Promise<SendResult | null> {
  if (!receipt.email) return null;
  return emailService.sendReceiptEmail({
    to: receipt.email,
    business,
    customerName: receipt.name,
    number: receipt.receiptNumber,
    amountPaid: receipt.amountPaid.toString(),
    currency: receipt.currency,
    issuedAt: receipt.createdAt,
    method: receipt.paymentMethod
      ? (PAYMENT_METHOD[receipt.paymentMethod] ?? null)
      : null,
    url: publicLink("receipt", receipt.publicId),
  });
}

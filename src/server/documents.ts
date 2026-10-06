import { cache } from "react";

import { db } from "@/server/db";
import { INVOICE_STATUS, PAYMENT_METHOD } from "@/utils/labels";
import type { SharedDocument } from "@/utils/shared-document";

const lineSelect = {
  description: true,
  quantity: true,
  total: true,
  service: { select: { name: true } },
} as const;

function toLines(
  rows: {
    description: string | null;
    quantity: number;
    total: unknown;
    service: { name: string };
  }[],
) {
  return rows.map((row) => ({
    // `||`: an empty description falls back to the service's name, as on the PDF.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    description: row.description || row.service.name,
    quantity: row.quantity,
    total: Number(row.total),
  }));
}

/** The invoice behind a customer's link, or null for an unknown id. */
export const getSharedInvoice = cache(
  async (publicId: string): Promise<SharedDocument | null> => {
    const invoice = await db.invoice.findUnique({
      where: { publicId },
      select: {
        invoiceNumber: true,
        status: true,
        clientName: true,
        currency: true,
        subtotal: true,
        taxAmount: true,
        discount: true,
        total: true,
        amountPaid: true,
        sentAt: true,
        createdAt: true,
        dueAt: true,
        notes: true,
        url: true,
        business: { select: { name: true } },
        services: { select: lineSelect },
      },
    });
    if (!invoice) return null;
    return {
      kind: "invoice",
      number: invoice.invoiceNumber,
      status: INVOICE_STATUS[invoice.status] ?? {
        label: invoice.status,
        tone: "muted",
      },
      voided: invoice.status === "VOID",
      businessName: invoice.business.name,
      customerName: invoice.clientName,
      currency: invoice.currency,
      lines: toLines(invoice.services),
      subtotal: Number(invoice.subtotal),
      taxAmount: Number(invoice.taxAmount),
      discount: Number(invoice.discount),
      total: Number(invoice.total),
      amountPaid: Number(invoice.amountPaid),
      balance:
        invoice.status === "VOID"
          ? 0
          : Math.max(
              0,
              Math.round(
                (Number(invoice.total) - Number(invoice.amountPaid)) * 100,
              ) / 100,
            ),
      issuedAt: (invoice.sentAt ?? invoice.createdAt).toISOString(),
      dueAt: invoice.dueAt?.toISOString() ?? null,
      paymentMethod: null,
      notes: invoice.notes,
      pdfUrl: invoice.url,
    };
  },
);

/** The receipt behind a customer's link, or null for an unknown id. */
export const getSharedReceipt = cache(
  async (publicId: string): Promise<SharedDocument | null> => {
    const receipt = await db.receipt.findUnique({
      where: { publicId },
      select: {
        receiptNumber: true,
        name: true,
        currency: true,
        subtotal: true,
        taxAmount: true,
        discount: true,
        total: true,
        amountPaid: true,
        paymentMethod: true,
        createdAt: true,
        notes: true,
        url: true,
        business: { select: { name: true } },
        services: { select: lineSelect },
      },
    });
    if (!receipt) return null;
    return {
      kind: "receipt",
      number: receipt.receiptNumber,
      status: { label: "Paid", tone: "accent" },
      voided: false,
      businessName: receipt.business.name,
      customerName: receipt.name,
      currency: receipt.currency,
      lines: toLines(receipt.services),
      subtotal: Number(receipt.subtotal),
      taxAmount: Number(receipt.taxAmount),
      discount: Number(receipt.discount),
      total: Number(receipt.total),
      amountPaid: Number(receipt.amountPaid),
      balance: 0,
      issuedAt: receipt.createdAt.toISOString(),
      dueAt: null,
      paymentMethod: receipt.paymentMethod
        ? (PAYMENT_METHOD[receipt.paymentMethod] ?? null)
        : null,
      notes: receipt.notes,
      pdfUrl: receipt.url,
    };
  },
);

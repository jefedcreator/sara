import type { Prisma } from "@prisma/client";

import { db } from "@/server/db";

export type DocumentKind = "invoice" | "receipt" | "order";

const lineSelect = {
  id: true,
  name: true,
  quantity: true,
  unitPrice: true,
  total: true,
} satisfies Prisma.InvoiceLineSelect;

type DocumentLine = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: string;
  total: string;
};

export type FoundDocument = {
  kind: DocumentKind;
  id: string;
  publicId: string;
  number: string;
  status: string;
  currency: string;
  clientName: string | null;
  subtotal: string;
  total: string;
  amountPaid: string | null;
  taxAmount: string | null;
  discount: string | null;
  deliveryFee: string | null;
  dueAt: string | null;
  lines: DocumentLine[];
};

function linesToJson(lines: { id: string; name: string; quantity: number; unitPrice: Prisma.Decimal; total: Prisma.Decimal }[]): DocumentLine[] {
  return lines.map((line) => ({
    id: line.id,
    name: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice.toString(),
    total: line.total.toString(),
  }));
}

class DocumentService {
  /** Numbers are unique within a business and document kind, never globally. */
  async find(businessId: string, kind: DocumentKind, number: string): Promise<FoundDocument | null> {
    if (kind === "order") {
      const order = await db.order.findFirst({
        where: { businessId, orderNumber: number },
        select: {
          id: true, publicId: true, orderNumber: true, status: true, currency: true,
          clientName: true, subtotal: true, total: true, deliveryFee: true,
          lines: { orderBy: { id: "asc" }, select: lineSelect },
        },
      });
      if (!order) return null;
      return {
        kind, id: order.id, publicId: order.publicId, number: order.orderNumber!,
        status: order.status, currency: order.currency, clientName: order.clientName,
        subtotal: order.subtotal.toString(), total: order.total.toString(),
        deliveryFee: order.deliveryFee.toString(),
        amountPaid: null, taxAmount: null, discount: null, dueAt: null,
        lines: linesToJson(order.lines),
      };
    }

    const select = {
      id: true, publicId: true, currency: true, subtotal: true, total: true,
      amountPaid: true, taxAmount: true, discount: true,
      lines: { orderBy: { position: "asc" }, select: lineSelect },
    } as const;
    if (kind === "invoice") {
      const invoice = await db.invoice.findFirst({
        where: { businessId, invoiceNumber: number },
        select: { ...select, invoiceNumber: true, status: true, clientName: true, dueAt: true },
      });
      if (!invoice) return null;
      return {
        kind, id: invoice.id, publicId: invoice.publicId, number: invoice.invoiceNumber,
        status: invoice.status, currency: invoice.currency, clientName: invoice.clientName,
        subtotal: invoice.subtotal.toString(), total: invoice.total.toString(),
        amountPaid: invoice.amountPaid.toString(), taxAmount: invoice.taxAmount.toString(),
        discount: invoice.discount.toString(), deliveryFee: null,
        dueAt: invoice.dueAt?.toISOString() ?? null,
        lines: linesToJson(invoice.lines),
      };
    }

    const receipt = await db.receipt.findFirst({
      where: { businessId, receiptNumber: number },
      select: { ...select, receiptNumber: true, name: true },
    });
    if (!receipt) return null;
    return {
      kind, id: receipt.id, publicId: receipt.publicId, number: receipt.receiptNumber,
      status: "PAID", currency: receipt.currency, clientName: receipt.name,
      subtotal: receipt.subtotal.toString(), total: receipt.total.toString(),
      amountPaid: receipt.amountPaid.toString(), taxAmount: receipt.taxAmount.toString(),
      discount: receipt.discount.toString(), deliveryFee: null, dueAt: null,
      lines: linesToJson(receipt.lines),
    };
  }
}

export const documentService = new DocumentService();

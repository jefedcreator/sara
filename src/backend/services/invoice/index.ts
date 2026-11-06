import { randomUUID } from "node:crypto";
import { customerService } from "@/backend/services/customer";
import {
  resolveDocumentLines,
  type DocumentLineInput,
} from "@/backend/services/lines";
import { db } from "@/server/db";
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import type { Prisma, Invoice, InvoiceStatus } from "@prisma/client";
import slugify from "slugify";
import { finalizeInvoice, invoiceInclude, type CreatedInvoice } from "./finalize";

export { finalizeInvoice, invoiceInclude } from "./finalize";
export type { CreatedInvoice } from "./finalize";

export type CreateInvoiceInput = {
  businessId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;
  amountPaid: number;
  dueAt?: Date | null;
  sentAt?: Date | null;
  paidAt?: Date | null;
  notes?: string | null;
  bookingId?: string | null;
  customerId?: string | null;
  lines?: DocumentLineInput[];
};

class InvoiceService {
  async create(input: CreateInvoiceInput): Promise<Invoice> {
    const invoice = await db.$transaction((tx) =>
      this.createInTransaction(tx, input),
    );
    await finalizeInvoice(invoice.id);
    return (await db.invoice.findUnique({ where: { id: invoice.id } })) ?? invoice;
  }

  /** All document and sale writes belong to the caller's transaction. */
  async createInTransaction(
    tx: Prisma.TransactionClient,
    input: CreateInvoiceInput,
  ): Promise<CreatedInvoice> {
    const business = await tx.business.findUnique({
      where: { id: input.businessId },
    });
    if (!business) throw new NotFoundException("Business not found");

    const lastInvoice = await tx.invoice.findFirst({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
      select: { invoiceNumber: true },
    });
    let invoiceNumber = "INV-1001";
    if (lastInvoice?.invoiceNumber.startsWith("INV-")) {
      const n = parseInt(lastInvoice.invoiceNumber.replace("INV-", ""), 10);
      invoiceNumber = `INV-${isNaN(n) ? 1001 : n + 1}`;
    }

    const [booking, existingInvoice] = await Promise.all([
      input.bookingId
        ? tx.booking.findFirst({
            where: { id: input.bookingId, businessId: business.id },
          })
        : Promise.resolve(null),
      tx.invoice.findUnique({
        where: {
          businessId_invoiceNumber: { businessId: business.id, invoiceNumber },
        },
      }),
    ]);
    if (input.bookingId && !booking) {
      throw new BadRequestException("Booking not found for this business");
    }
    if (existingInvoice) {
      throw new ConflictException(
        `Invoice with number ${invoiceNumber} already exists for this business`,
      );
    }

    const resolvedLines = await resolveDocumentLines(
      tx,
      business.id,
      input.lines ?? [],
    );

    const customer = input.customerId
      ? await customerService.ownedBy(tx, business.id, input.customerId)
      : await customerService.resolve(tx, {
          businessId: business.id,
          name: input.name,
          phone: input.phone,
          email: input.email,
        });

    const createData: Prisma.InvoiceUncheckedCreateInput = {
      businessId: business.id,
      customerId: customer?.id ?? null,
      // Names are not unique across businesses. Keep slugs independent of the
      // document-number constraint so numbering races can retry that constraint.
      slug: slugify(`${business.name}-${invoiceNumber}-${randomUUID()}`, { lower: true, strict: true }),
      clientName: input.name,
      clientEmail: input.email ?? null,
      clientPhone: input.phone ?? null,
      invoiceNumber,
      status: input.status,
      currency: input.currency,
      subtotal: input.subtotal,
      taxAmount: input.taxAmount,
      discount: input.discount,
      total: input.total,
      amountPaid: input.amountPaid,
      dueAt: input.dueAt ?? null,
      sentAt: input.sentAt ?? null,
      paidAt: input.paidAt ?? null,
      notes: input.notes ?? null,
      bookingId: input.bookingId ?? null,
    };
    if (resolvedLines.length > 0) {
      createData.lines = { create: resolvedLines };
    }

    const invoice = await tx.invoice.create({
      data: createData,
      include: invoiceInclude,
    });
    if (!invoice.business) {
      throw new InternalServerErrorException(
        "Failed to retrieve business details for the invoice",
      );
    }

    return invoice;
  }
}

export const invoiceService = new InvoiceService();

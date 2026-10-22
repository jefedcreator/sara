import { cloudinaryService } from "@/backend/services/cloudinary";
import { customerService } from "@/backend/services/customer";
import {
  resolveDocumentLines,
  type DocumentLineInput,
} from "@/backend/services/lines";
import { generateInvoicePdf } from "@/backend/services/pdf";
import { db } from "@/server/db";
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { Prisma, type Invoice, type InvoiceStatus } from "@prisma/client";
import slugify from "slugify";

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
    const invoice = await db.$transaction(async (tx) => {
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
      if (lastInvoice && lastInvoice.invoiceNumber.startsWith("INV-")) {
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
        slug: slugify(`${business.name}-${invoiceNumber}`, { lower: true, strict: true }),
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
        include: {
          business: true,
          lines: { include: { service: true }, orderBy: { position: "asc" } },
        },
      });
      if (!invoice.business) {
        throw new InternalServerErrorException(
          "Failed to retrieve business details for the invoice",
        );
      }

      return invoice;
    });

    let pdfUrl: string | null = null;
    try {
      const pdfBuffer = await generateInvoicePdf({
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        currency: invoice.currency,
        subtotal: invoice.subtotal.toString(),
        taxAmount: invoice.taxAmount.toString(),
        discount: invoice.discount.toString(),
        total: invoice.total.toString(),
        amountPaid: invoice.amountPaid.toString(),
        dueAt: invoice.dueAt,
        sentAt: invoice.sentAt,
        paidAt: invoice.paidAt,
        notes: invoice.notes,
        business: {
          name: invoice.business.name,
          email: invoice.business.email,
          phone: invoice.business.phone,
          city: invoice.business.city,
          state: invoice.business.state,
          country: invoice.business.country,
          logoUrl: invoice.business.logoUrl,
        },
        client: {
          name: invoice.clientName,
          email: invoice.clientEmail,
          phone: invoice.clientPhone,
        },
        items: invoice.lines.map((item) => ({
          description: item.description || item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          total: item.total.toString(),
        })),
      });

      const uploadResult = await cloudinaryService.uploadImage(pdfBuffer, {
        filename: `${invoice.invoiceNumber}.pdf`,
        folder: `sara/businesses/${invoice.business.id}/invoices`,
        mime_type: "application/pdf",
        public_id: invoice.id,
        resource_type: "raw",
      });

      pdfUrl = uploadResult.secure_url;
    } catch (error) {
      console.error(`Failed to generate or upload invoice PDF for ${invoice.id}:`, error);
    }

    if (pdfUrl) {
      return db.invoice.update({
        where: { id: invoice.id },
        data: { url: pdfUrl },
      });
    }

    return invoice;
  }
}

export const invoiceService = new InvoiceService();

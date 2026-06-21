import { cloudinaryService } from "@/backend/services/cloudinary";
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
  services?: Array<{
    serviceId: string;
    description?: string | null;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
};

class InvoiceService {
  async create(input: CreateInvoiceInput): Promise<Invoice> {
    return db.$transaction(async (tx) => {
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

      const lineItems = input.services ?? [];
      const serviceIds = Array.from(
        new Set(
          lineItems.map((i) => i.serviceId).filter((id): id is string => Boolean(id)),
        ),
      );
      if (serviceIds.length > 0) {
        const services = await tx.service.findMany({
          where: { id: { in: serviceIds }, businessId: business.id },
          select: { id: true },
        });
        if (services.length !== serviceIds.length) {
          throw new BadRequestException(
            "One or more invoice item services do not belong to this business",
          );
        }
      }

      const createData: Prisma.InvoiceCreateInput = {
        business: { connect: { id: business.id } },
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
      };
      if (input.bookingId) createData.booking = { connect: { id: input.bookingId } };
      if (lineItems.length > 0) {
        createData.services = {
          create: lineItems.map((item) => ({
            serviceId: item.serviceId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
          })),
        };
      }

      const invoice = await tx.invoice.create({
        data: createData,
        include: { business: true, services: { include: { service: true } } },
      });
      if (!invoice.business) {
        throw new InternalServerErrorException(
          "Failed to retrieve business details for the invoice",
        );
      }

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
        items: invoice.services.map((item) => ({
          description: item.description || item.service.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          total: item.total.toString(),
        })),
      });

      const uploadResult = await cloudinaryService.uploadImage(pdfBuffer, {
        filename: `${invoice.invoiceNumber}.pdf`,
        folder: `sara/businesses/${business.id}/invoices`,
        mime_type: "application/pdf",
        public_id: invoice.id,
        resource_type: "raw",
      });

      return tx.invoice.update({
        where: { id: invoice.id },
        data: { url: uploadResult.secure_url },
      });
    });
  }
}

export const invoiceService = new InvoiceService();

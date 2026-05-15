import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import {
  updateInvoiceValidatorSchema,
  type UpdateInvoiceValidatorSchema,
} from "@/backend/validators/invoice.validator";
import { db } from "@/server/db";
import { generateInvoicePdf } from "@/backend/services/pdf";
import { cloudinaryService } from "@/backend/services/cloudinary";
import { type ApiResponse, type InvoiceListItem } from "types";
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { type Invoice, type Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

/**
 * @body UpdateInvoiceValidatorSchema
 * @pathParams slugParamValidator
 * @description Updates an existing invoice for the authenticated user's business.
 * @contentType application/json
 * @auth bearer
 */
export const PUT = withMiddleware<UpdateInvoiceValidatorSchema>(
  async (request, { params }) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;
      const { slug } = params;

      const invoice = await db.invoice.findUnique({
        where: { slug },
        include: { business: { select: { ownerId: true } } },
      });

      if (!invoice) {
        throw new NotFoundException("Invoice not found");
      }

      if (invoice.status === "PAID" || invoice.status === "PARTIALLY_PAID") {
        throw new BadRequestException("Invoice cannot be updated");
      }

      if (invoice.business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You are not authorized to update this invoice",
        );
      }

      const data: Prisma.InvoiceUpdateInput = {};

      if (payload.name) data.clientName = payload.name;
      if (payload.email !== undefined) data.clientEmail = payload.email ?? null;
      if (payload.phone !== undefined) data.clientPhone = payload.phone ?? null;
      if (payload.status) data.status = payload.status;
      if (payload.currency) data.currency = payload.currency;
      if (payload.subtotal !== undefined) data.subtotal = payload.subtotal;
      if (payload.taxAmount !== undefined) data.taxAmount = payload.taxAmount;
      if (payload.discount !== undefined) data.discount = payload.discount;
      if (payload.total !== undefined) data.total = payload.total;
      if (payload.amountPaid !== undefined)
        data.amountPaid = payload.amountPaid;
      if (payload.dueAt !== undefined) data.dueAt = payload.dueAt ?? null;
      if (payload.sentAt !== undefined) data.sentAt = payload.sentAt ?? null;
      if (payload.paidAt !== undefined) data.paidAt = payload.paidAt ?? null;
      if (payload.notes !== undefined) data.notes = payload.notes ?? null;

      if (payload.bookingId !== undefined) {
        data.booking = payload.bookingId
          ? { connect: { id: payload.bookingId } }
          : { disconnect: true };
      }

      if (payload.items) {
        data.items = {
          deleteMany: {},
          create: payload.items.map((item) => ({
            serviceId: item.serviceId ?? null,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
          })),
        };
      }

      const updatedInvoicedata = await db.$transaction(async (tx) => {
        const invoiceRecord = await tx.invoice.update({
          where: { slug },
          data,
          include: {
            business: true,
            items: true,
          },
        });

        if (!invoiceRecord.business) {
          throw new InternalServerErrorException(
            "Failed to retrieve business details for the invoice",
          );
        }

        const pdfBuffer = await generateInvoicePdf({
          invoiceNumber: invoiceRecord.invoiceNumber,
          status: invoiceRecord.status,
          currency: invoiceRecord.currency,
          subtotal: invoiceRecord.subtotal.toString(),
          taxAmount: invoiceRecord.taxAmount.toString(),
          discount: invoiceRecord.discount.toString(),
          total: invoiceRecord.total.toString(),
          amountPaid: invoiceRecord.amountPaid.toString(),
          dueAt: invoiceRecord.dueAt,
          sentAt: invoiceRecord.sentAt,
          paidAt: invoiceRecord.paidAt,
          notes: invoiceRecord.notes,
          business: {
            name: invoiceRecord.business.name,
            email: invoiceRecord.business.email,
            phone: invoiceRecord.business.phone,
            city: invoiceRecord.business.city,
            state: invoiceRecord.business.state,
            country: invoiceRecord.business.country,
            logoUrl: invoiceRecord.business.logoUrl,
          },
          client: {
            name: invoiceRecord.clientName,
            email: invoiceRecord.clientEmail,
            phone: invoiceRecord.clientPhone,
          },
          items: invoiceRecord.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice.toString(),
            total: item.total.toString(),
          })),
        });

        const uploadResult = await cloudinaryService.uploadImage(pdfBuffer, {
          filename: `${invoiceRecord.invoiceNumber}.pdf`,
          folder: `sara/businesses/${invoiceRecord.business.id}/invoices`,
          mime_type: "application/pdf",
          public_id: invoiceRecord.id,
          resource_type: "raw",
        });

        // Update the invoice with the Cloudinary URL (if it changed or to ensure it's set)
        const finalInvoice = await tx.invoice.update({
          where: { id: invoiceRecord.id },
          data: { url: uploadResult.secure_url },
        });

        return finalInvoice;
      });

      const response: ApiResponse<Invoice> = {
        status: 200,
        message: "Invoice updated successfully",
        data: updatedInvoicedata,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while updating invoice: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(updateInvoiceValidatorSchema)],
);

/**
 * @pathParams slugParamValidator
 * @description Deletes an existing invoice for the authenticated user's business.
 * @auth bearer
 */
export const DELETE = withMiddleware<unknown>(
  async (request, { params }) => {
    try {
      const user = request.user!;
      const { slug } = params;

      const invoice = await db.invoice.findUnique({
        where: { slug },
        include: { business: { select: { ownerId: true } } },
      });

      if (!invoice) {
        throw new NotFoundException("Invoice not found");
      }

      if (invoice.business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You are not authorized to delete this invoice",
        );
      }

      const deletedInvoice = await db.invoice.delete({
        where: { slug },
      });

      const response: ApiResponse<Invoice> = {
        status: 200,
        message: "Invoice deleted successfully",
        data: deletedInvoice,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while deleting invoice: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

/**
 * @pathParams slugParamValidator
 * @description Retrieves a single invoice by slug for the authenticated user's business.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request, { params }) => {
    try {
      const user = request.user!;
      const { slug } = params;

      const invoice = await db.invoice.findUnique({
        where: { slug },
        include: {
          items: true,
          business: true,
          booking: {
            select: {
              id: true,
              slug: true,
              clientName: true,
              startTime: true,
            },
          },
          payments: true,
          _count: {
            select: {
              items: true,
              payments: true,
            },
          },
        },
      });

      if (!invoice) {
        throw new NotFoundException("Invoice not found");
      }

      if (invoice.business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You are not authorized to view this invoice",
        );
      }

      const response: ApiResponse<InvoiceListItem> = {
        status: 200,
        message: "Invoice retrieved successfully",
        data: invoice,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching invoice: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

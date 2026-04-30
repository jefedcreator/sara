import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { cloudinaryService } from "@/backend/services/cloudinary";
import { generateInvoicePdf } from "@/backend/services/pdf";
import {
  invoiceValidatorSchema,
  type InvoiceValidatorSchema,
} from "@/backend/validators/invoice.validator";
import { db } from "@/server/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * @body InvoiceValidatorSchema
 * @description Creates a new invoice for a business, generates a PDF, and uploads it to Cloudinary.
 * @contentType application/json
 * @auth bearer
 */
export const POST = withMiddleware<InvoiceValidatorSchema>(
  async (request) => {
    let createdInvoiceId: string | null = null;

    try {
      const payload = request.validatedData!;
      const user = request.user!;

      const business = await db.business.findUnique({
        where: { id: payload.businessId },
        include: {
          members: {
            where: { userId: user.id },
            select: { userId: true },
            take: 1,
          },
          profile: true,
        },
      });

      if (!business) {
        throw new NotFoundException("Business not found");
      }

      const canCreateInvoice =
        business.ownerId === user.id || business.members.length > 0;

      if (!canCreateInvoice) {
        throw new ForbiddenException(
          "You do not have permission to create invoices for this business",
        );
      }

      const [booking, existingInvoice] = await Promise.all([
        payload.bookingId
          ? db.booking.findFirst({
              where: {
                id: payload.bookingId,
                businessId: payload.businessId,
              },
            })
          : Promise.resolve(null),
        db.invoice.findUnique({
          where: {
            businessId_invoiceNumber: {
              businessId: payload.businessId,
              invoiceNumber: payload.invoiceNumber,
            },
          },
        }),
      ]);

      if (payload.bookingId && !booking) {
        throw new BadRequestException("Booking not found for this business");
      }

      if (existingInvoice) {
        throw new ConflictException(
          "Invoice with this invoice number already exists for this business",
        );
      }

      const serviceIds = [
        ...new Set(
          (payload.items ?? [])
            .map((item) => item.serviceId)
            .filter((serviceId): serviceId is string => Boolean(serviceId)),
        ),
      ];

      if (serviceIds.length > 0) {
        const services = await db.service.findMany({
          where: {
            id: { in: serviceIds },
            businessId: payload.businessId,
          },
          select: { id: true },
        });

        if (services.length !== serviceIds.length) {
          throw new BadRequestException(
            "One or more invoice item services do not belong to this business",
          );
        }
      }

      const invoice = await db.invoice.create({
        data: {
          businessId: payload.businessId,
          clientName: payload.name,
          clientEmail: payload.email ?? null,
          clientPhone: payload.phone ?? null,
          bookingId: payload.bookingId ?? null,
          invoiceNumber: payload.invoiceNumber,
          status: payload.status,
          currency: payload.currency,
          subtotal: payload.subtotal,
          taxAmount: payload.taxAmount,
          discount: payload.discount,
          total: payload.total,
          amountPaid: payload.amountPaid,
          dueAt: payload.dueAt ?? null,
          sentAt: payload.sentAt ?? null,
          paidAt: payload.paidAt ?? null,
          notes: payload.notes ?? null,
          items:
            payload.items && payload.items.length > 0
              ? {
                  create: payload.items.map((item) => ({
                    serviceId: item.serviceId ?? null,
                    description: item.description,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    total: item.total,
                  })),
                }
              : undefined,
        },
        include: {
          business: {
            include: {
              profile: true,
            },
          },
          items: true,
        },
      });
      createdInvoiceId = invoice.id;

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
          logoUrl: invoice.business.profile?.logoUrl,
        },
        client: {
          name: invoice.clientName,
          email: invoice.clientEmail,
          phone: invoice.clientPhone,
        },
        items: invoice.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          total: item.total.toString(),
        })),
      });

      const uploadResult = await cloudinaryService.uploadImage(pdfBuffer, {
        filename: `${invoice.invoiceNumber}.pdf`,
        folder: `sara/businesses/${payload.businessId}/invoices`,
        mime_type: "application/pdf",
        public_id: `${invoice.id}.pdf`,
        resource_type: "raw",
      });

      return NextResponse.json(
        {
          status: 201,
          message: "Invoice created successfully",
          data: {
            invoice,
            pdf: {
              url: uploadResult.secure_url,
              publicId: uploadResult.public_id,
            },
          },
        },
        { status: 201 },
      );
    } catch (error: any) {
      if (createdInvoiceId && !error.statusCode) {
        await db.invoice
          .delete({
            where: { id: createdInvoiceId },
          })
          .catch((cleanupError) => {
            console.error(
              "Failed to clean up invoice after PDF error:",
              cleanupError,
            );
          });
      }

      if (error.statusCode) throw error;

      throw new InternalServerErrorException(
        `An error occurred while creating invoice: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(invoiceValidatorSchema)],
);

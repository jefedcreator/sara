import {
  authMiddleware,
  bodyValidatorMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import {
  invoiceQueryValidatorSchema,
  type InvoiceQueryValidatorSchema,
} from "@/backend/validators/invoice.validator";
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
import { Prisma, type Invoice } from "@prisma/client";
import { NextResponse } from "next/server";
import slugify from "slugify";
import type { ApiResponse, CreatedInvoice, InvoiceListItem, PaginatedApiResponse } from "types";

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

      // const business = await db.business.findUnique({
      //   where: { id: payload.businessId },
      // });

      const business = user.business;

      if (!business) {
        throw new NotFoundException("Business not found");
      }

      const canCreateInvoice = business.ownerId === user.id;

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

      const serviceIds = Array.from(
        new Set(
          (payload.items ?? [])
            .map((item) => item.serviceId)
            .filter((serviceId): serviceId is string => Boolean(serviceId)),
        ),
      );

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

      const data: Prisma.InvoiceCreateInput = {
        business: {
          connect: {
            id: payload.businessId,
          },
        },
        slug: slugify(`${payload.name}-${payload.invoiceNumber}-${Date.now()}`, { lower: true, strict: true }),
        clientName: payload.name,
        clientEmail: payload.email ?? null,
        clientPhone: payload.phone ?? null,
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
      }

      if (payload.bookingId) {
        data.booking = {
          connect: {
            id: payload.bookingId,
          },
        }
      }

      if (payload.items && payload.items.length > 0) {
        data.items = {
          create: payload.items.map((item) => ({
            serviceId: item.serviceId ?? null,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
          })),
        }
      }

      const invoice = await db.invoice.create({
        data,
        include: {
          business: true,
          items: true,
        },
      })

      createdInvoiceId = invoice.id;

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

      const invoicedata: CreatedInvoice = {
        ...invoice,
        pdf: {
          url: uploadResult.secure_url,
          publicId: uploadResult.public_id,
        },
      }

      const response: ApiResponse<CreatedInvoice> = {
        status: 201,
        message: "Invoice created successfully",
        data: invoicedata,
      }

      return NextResponse.json(
        response,
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

/**
 * @queryParams InvoiceQueryValidatorSchema
 * @description Retrieves invoices for the authenticated user's business. Supports search, pagination, and filtering.
 * @auth bearer
 */
export const GET = withMiddleware<InvoiceQueryValidatorSchema, InvoiceQueryValidatorSchema>(
  async (request) => {
    try {
      const payload = request.query!;
      const user = request.user!;

      // Only return invoices for businesses owned by the authenticated user
      const business = await db.business.findUnique({
        where: { ownerId: user.id },
        select: { id: true },
      });

      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      const where: Prisma.InvoiceWhereInput = {
        businessId: business.id,
      };

      // Filter by specific businessId if provided (must still be the user's business)
      if (payload.businessId && payload.businessId !== business.id) {
        throw new ForbiddenException(
          "You do not have permission to view invoices for this business",
        );
      }

      if (payload.status) {
        where.status = payload.status;
      }

      if (payload.clientName) {
        where.clientName = { contains: payload.clientName, mode: "insensitive" };
      }

      if (payload.clientEmail) {
        where.clientEmail = { contains: payload.clientEmail, mode: "insensitive" };
      }

      if (payload.bookingId) {
        where.bookingId = payload.bookingId;
      }

      if (payload.invoiceNumber) {
        where.invoiceNumber = { contains: payload.invoiceNumber, mode: "insensitive" };
      }

      // Date range filters
      if (payload.dueFrom || payload.dueTo) {
        where.dueAt = {
          ...(payload.dueFrom && { gte: payload.dueFrom }),
          ...(payload.dueTo && { lte: payload.dueTo }),
        };
      }

      if (payload.createdFrom || payload.createdTo) {
        where.createdAt = {
          ...(payload.createdFrom && { gte: payload.createdFrom }),
          ...(payload.createdTo && { lte: payload.createdTo }),
        };
      }

      // Text search across multiple fields
      if (payload.query) {
        where.OR = [
          { clientName: { contains: payload.query, mode: "insensitive" } },
          { clientEmail: { contains: payload.query, mode: "insensitive" } },
          { invoiceNumber: { contains: payload.query, mode: "insensitive" } },
        ];
      }

      const orderBy: Prisma.InvoiceOrderByWithRelationInput = {
        [payload.sortBy ?? "createdAt"]: payload.sortOrder ?? "desc",
      };

      const include: Prisma.InvoiceInclude = {
        items: true,
        booking: {
          select: {
            id: true,
            slug: true,
            clientName: true,
            startTime: true,
          },
        },
        _count: {
          select: {
            items: true,
            payments: true,
          },
        },
      };

      if (payload.all) {
        const data = await db.invoice.findMany({
          where,
          include,
          orderBy,
        });

        const response: PaginatedApiResponse<InvoiceListItem[]> = {
          status: 200,
          message: "Invoices retrieved successfully",
          data,
          total: data.length,
          page: 1,
          size: data.length || 1,
          totalPages: 1,
        }

        return NextResponse.json(response);
      }

      const page = payload.page ?? 1;
      const size = payload.size ?? 10;
      const skip = (page - 1) * size;

      const [count, data] = await Promise.all([
        db.invoice.count({ where }),
        db.invoice.findMany({
          where,
          take: size,
          skip,
          orderBy,
          include,
        }),
      ]);

      const response: PaginatedApiResponse<InvoiceListItem[]> = {
        status: 200,
        message: "Invoices retrieved successfully",
        data,
        total: count,
        page,
        size,
        totalPages: Math.ceil(count / size),
      }

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;

      throw new InternalServerErrorException(
        `An error occurred while fetching invoices: ${error.message}`,
      );
    }
  },
  [authMiddleware, queryValidatorMiddleware(invoiceQueryValidatorSchema)],
);

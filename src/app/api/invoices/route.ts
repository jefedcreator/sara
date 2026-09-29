import {
  authMiddleware,
  bodyValidatorMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { invoiceService } from "@/backend/services/invoice";
import {
  invoiceQueryValidatorSchema,
  invoiceValidatorSchema,
  type InvoiceQueryValidatorSchema,
  type InvoiceValidatorSchema,
} from "@/backend/validators/invoice.validator";
import { publicBusinessSelect } from "@/backend/selects";
import { UNPAID_STATUSES } from "@/backend/services/dashboard";
import { db } from "@/server/db";
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { Prisma, type Invoice } from "@prisma/client";
import { NextResponse } from "next/server";
import type { ApiResponse, InvoiceListItem, PaginatedApiResponse } from "types";

/**
 * @body InvoiceValidatorSchema
 * @description Creates a new invoice for a business, generates a PDF, and uploads it to Cloudinary.
 * @contentType application/json
 * @auth bearer
 */
export const POST = withMiddleware<InvoiceValidatorSchema>(
  async (request) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;
      const business = user.business;

      if (!business) {
        throw new NotFoundException("Business not found");
      }

      if (business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You do not have permission to create invoices for this business",
        );
      }

      const invoicedata = await invoiceService.create({
        businessId: business.id,
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        status: payload.status,
        currency: payload.currency,
        subtotal: payload.subtotal,
        taxAmount: payload.taxAmount,
        discount: payload.discount,
        total: payload.total,
        amountPaid: payload.amountPaid,
        dueAt: payload.dueAt,
        sentAt: payload.sentAt,
        paidAt: payload.paidAt,
        notes: payload.notes,
        bookingId: payload.bookingId,
        services: payload.services,
      });

      const response: ApiResponse<Invoice> = {
        status: 201,
        message: "Invoice created successfully",
        data: invoicedata,
      };

      return NextResponse.json(response, { status: 201 });
    } catch (error: any) {
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
export const GET = withMiddleware<InvoiceQueryValidatorSchema>(
  async (request) => {
    try {
      const payload = request.query!;
      const user = request.user!;

      // Only return invoices for businesses owned by the authenticated user
      const business = await db.business.findUnique({
        where: { ownerId: user.id },
        select: { id: true, ownerId: true },
      });

      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      const where: Prisma.InvoiceWhereInput = {
        businessId: business.id,
      };

      // Filter by specific businessId if provided (must still be the user's business)
      if (user.id !== business.ownerId) {
        throw new ForbiddenException(
          "You do not have permission to view invoices for this business",
        );
      }

      if (payload.status) {
        where.status = payload.status;
      } else if (payload.unpaid) {
        where.status = { in: UNPAID_STATUSES };
      }

      if (payload.clientName) {
        where.clientName = {
          contains: payload.clientName,
          mode: "insensitive",
        };
      }

      if (payload.clientEmail) {
        where.clientEmail = {
          contains: payload.clientEmail,
          mode: "insensitive",
        };
      }

      if (payload.bookingId) {
        where.bookingId = payload.bookingId;
      }

      if (payload.invoiceNumber) {
        where.invoiceNumber = {
          contains: payload.invoiceNumber,
          mode: "insensitive",
        };
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

      const include = {
        business: { select: publicBusinessSelect },
        payments: true,
        services: { include: { service: true } },
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
            payments: true,
          },
        },
      };

      if (payload.all) {
        const data = (await db.invoice.findMany({
          where,
          include,
          orderBy,
        }));

        const response: PaginatedApiResponse<InvoiceListItem[]> = {
          status: 200,
          message: "Invoices retrieved successfully",
          data,
          total: data.length,
          page: 1,
          size: data.length || 1,
          totalPages: 1,
        };

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
      };

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

import {
  authMiddleware,
  bodyValidatorMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { receiptService } from "@/backend/services/receipt";
import {
  receiptValidatorSchema,
  receiptQueryValidatorSchema,
  type ReceiptValidatorSchema,
  type ReceiptQueryValidatorSchema,
} from "@/backend/validators/receipt.validator";
import { db } from "@/server/db";
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { Prisma, type Receipt } from "@prisma/client";
import { NextResponse } from "next/server";
import type { ApiResponse, ReceiptListItem, PaginatedApiResponse } from "types";

/**
 * @body ReceiptValidatorSchema
 * @description Creates a new receipt for a business.
 * @contentType application/json
 * @auth bearer
 */
export const POST = withMiddleware<ReceiptValidatorSchema>(
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
          "You do not have permission to create receipts for this business",
        );
      }

      const receiptResult = await receiptService.create({
        businessId: business.id,
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        currency: payload.currency,
        subtotal: payload.subtotal,
        taxAmount: payload.taxAmount,
        discount: payload.discount,
        total: payload.total,
        amountPaid: payload.amountPaid,
        paymentMethod: payload.paymentMethod,
        notes: payload.notes,
        paymentId: payload.paymentId,
        services: payload.services,
      });

      const response: ApiResponse<Receipt> = {
        status: 201,
        message: "Receipt created successfully",
        data: receiptResult,
      };

      return NextResponse.json(response, { status: 201 });
    } catch (error: any) {
      if (error.statusCode) throw error;

      throw new InternalServerErrorException(
        `An error occurred while creating receipt: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(receiptValidatorSchema)],
);

/**
 * @queryParams ReceiptQueryValidatorSchema
 * @description Retrieves receipts for the authenticated user's business. Supports search, pagination, and filtering.
 * @auth bearer
 */
export const GET = withMiddleware<ReceiptQueryValidatorSchema>(
  async (request) => {
    try {
      const payload = request.query!;
      const user = request.user!;

      const business = user.business;

      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      const where: Prisma.ReceiptWhereInput = {
        businessId: business.id,
      };

      if (user.id !== business.ownerId) {
        throw new ForbiddenException(
          "You do not have permission to view receipts for this business",
        );
      }

      if (payload.name) {
        where.name = { contains: payload.name, mode: "insensitive" };
      }

      if (payload.email) {
        where.email = { contains: payload.email, mode: "insensitive" };
      }

      if (payload.paymentId) {
        where.paymentId = payload.paymentId;
      }

      if (payload.createdFrom || payload.createdTo) {
        where.createdAt = {
          ...(payload.createdFrom && { gte: payload.createdFrom }),
          ...(payload.createdTo && { lte: payload.createdTo }),
        };
      }

      if (payload.query) {
        where.OR = [
          { name: { contains: payload.query, mode: "insensitive" } },
          { email: { contains: payload.query, mode: "insensitive" } },
          { receiptNumber: { contains: payload.query, mode: "insensitive" } },
        ];
      }

      const orderBy: Prisma.ReceiptOrderByWithRelationInput = {
        [payload.sortBy ?? "createdAt"]: payload.sortOrder ?? "desc",
      };

      const include: Prisma.ReceiptInclude = {
        payment: {
          include: {
            invoice: {
              select: {
                id: true,
                slug: true,
                invoiceNumber: true,
              },
            },
          },
        },
        business: true,
        services: { include: { service: true } },
      };

      if (payload.all) {
        const data = (await db.receipt.findMany({
          where,
          include,
          orderBy,
        })) as unknown as ReceiptListItem[];

        const response: PaginatedApiResponse<ReceiptListItem[]> = {
          status: 200,
          message: "Receipts retrieved successfully",
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
        db.receipt.count({ where }),
        db.receipt.findMany({
          where,
          take: size,
          skip,
          orderBy,
          include,
        }) as unknown as Promise<ReceiptListItem[]>,
      ]);

      const response: PaginatedApiResponse<ReceiptListItem[]> = {
        status: 200,
        message: "Receipts retrieved successfully",
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
        `An error occurred while fetching receipts: ${error.message}`,
      );
    }
  },
  [authMiddleware, queryValidatorMiddleware(receiptQueryValidatorSchema)],
);

import {
  authMiddleware,
  bodyValidatorMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import {
  receiptValidatorSchema,
  receiptQueryValidatorSchema,
  type ReceiptValidatorSchema,
  type ReceiptQueryValidatorSchema,
} from "@/backend/validators/receipt.validator";
import { db } from "@/server/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import slugify from "slugify";
import type { ApiResponse, ReceiptListItem, PaginatedApiResponse } from "types";

export const runtime = "nodejs";

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

      const business = await db.business.findUnique({
        where: { id: payload.businessId },
      });

      if (!business) {
        throw new NotFoundException("Business not found");
      }

      if (business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You do not have permission to create receipts for this business",
        );
      }

      // Validate that the payment belongs to this business and doesn't already have a receipt
      const payment = await db.payment.findFirst({
        where: {
          id: payload.paymentId,
          businessId: payload.businessId,
        },
        include: { receipt: { select: { id: true } } },
      });

      if (!payment) {
        throw new BadRequestException("Payment not found for this business");
      }

      if (payment.receipt) {
        throw new ConflictException("A receipt already exists for this payment");
      }

      const receipt = await db.receipt.create({
        data: {
          business: {
            connect: { id: payload.businessId },
          },
          payment: {
            connect: { id: payload.paymentId },
          },
          slug: slugify(`${payload.receiptNumber}-${Date.now()}`, { lower: true, strict: true }),
          receiptNumber: payload.receiptNumber,
          clientName: payload.clientName ?? null,
          clientEmail: payload.clientEmail ?? null,
          clientPhone: payload.clientPhone ?? null,
        },
        include: {
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
        },
      });

      const response: ApiResponse<ReceiptListItem> = {
        status: 201,
        message: "Receipt created successfully",
        data: receipt,
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
export const GET = withMiddleware<ReceiptQueryValidatorSchema, ReceiptQueryValidatorSchema>(
  async (request) => {
    try {
      const payload = request.query!;
      const user = request.user!;

      const business = await db.business.findUnique({
        where: { ownerId: user.id },
        select: { id: true },
      });

      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      const where: Prisma.ReceiptWhereInput = {
        businessId: business.id,
      };

      if (payload.businessId && payload.businessId !== business.id) {
        throw new ForbiddenException(
          "You do not have permission to view receipts for this business",
        );
      }

      if (payload.clientName) {
        where.clientName = { contains: payload.clientName, mode: "insensitive" };
      }

      if (payload.clientEmail) {
        where.clientEmail = { contains: payload.clientEmail, mode: "insensitive" };
      }

      if (payload.receiptNumber) {
        where.receiptNumber = { contains: payload.receiptNumber, mode: "insensitive" };
      }

      if (payload.paymentId) {
        where.paymentId = payload.paymentId;
      }

      if (payload.issuedFrom || payload.issuedTo) {
        where.issuedAt = {
          ...(payload.issuedFrom && { gte: payload.issuedFrom }),
          ...(payload.issuedTo && { lte: payload.issuedTo }),
        };
      }

      if (payload.query) {
        where.OR = [
          { clientName: { contains: payload.query, mode: "insensitive" } },
          { clientEmail: { contains: payload.query, mode: "insensitive" } },
          { receiptNumber: { contains: payload.query, mode: "insensitive" } },
        ];
      }

      const orderBy: Prisma.ReceiptOrderByWithRelationInput = {
        [payload.sortBy ?? "issuedAt"]: payload.sortOrder ?? "desc",
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
      };

      if (payload.all) {
        const data = await db.receipt.findMany({
          where,
          include,
          orderBy,
        });

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
        }),
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

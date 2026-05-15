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
import { Prisma, type Receipt } from "@prisma/client";
import { NextResponse } from "next/server";
import slugify from "slugify";
import type { ApiResponse, ReceiptListItem, PaginatedApiResponse } from "types";
import { cloudinaryService } from "@/backend/services/cloudinary";
import { generateReceiptPdf } from "@/backend/services/pdf";

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

      const receiptResult = await db.$transaction(async (tx) => {
        // Validate that the payment belongs to this business and doesn't already have a receipt
        if (payload.paymentId) {
          const payment = await tx.payment.findFirst({
            where: {
              id: payload.paymentId,
              businessId: business.id,
            },
            include: { receipt: { select: { id: true } } },
          });

          if (!payment) {
            throw new BadRequestException("Payment not found for this business");
          }

          if (payment.receipt) {
            throw new ConflictException("A receipt already exists for this payment");
          }
        }

        let receiptNumber = "";
        const lastReceipt = await tx.receipt.findFirst({
          where: { businessId: business.id },
          orderBy: { createdAt: "desc" },
          select: { receiptNumber: true },
        });

        if (lastReceipt && lastReceipt.receiptNumber.startsWith("RCP-")) {
          const lastNumber = parseInt(lastReceipt.receiptNumber.replace("RCP-", ""), 10);
          receiptNumber = `RCP-${isNaN(lastNumber) ? 1001 : lastNumber + 1}`;
        } else {
          receiptNumber = "RCP-1001";
        }

        const createData: Prisma.ReceiptCreateInput = {
          business: {
            connect: { id: business.id },
          },
          slug: slugify(`${business.name}-${receiptNumber}`, { lower: true, strict: true }),
          receiptNumber,
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
        };

        if (payload.paymentId) {
          createData.payment = {
            connect: { id: payload.paymentId },
          };
        }

        if (payload.items && payload.items.length > 0) {
          createData.items = {
            create: payload.items.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total,
            })),
          };
        }

        const receipt = await tx.receipt.create({
          data: createData,
          include: { business: true, items: true },
        });

        if (!receipt.business) {
          throw new InternalServerErrorException(
            "Failed to retrieve business details for the receipt",
          );
        }

        // Generate PDF
        const pdfBuffer = await generateReceiptPdf({
          receiptNumber: receipt.receiptNumber,
          paymentMethod: receipt.paymentMethod,
          currency: receipt.currency,
          subtotal: receipt.subtotal.toString(),
          taxAmount: receipt.taxAmount.toString(),
          discount: receipt.discount.toString(),
          total: receipt.total.toString(),
          amountPaid: receipt.amountPaid.toString(),
          paidAt: receipt.createdAt, // Using createdAt as paidAt
          notes: receipt.notes,
          business: {
            name: receipt.business.name,
            email: receipt.business.email,
            phone: receipt.business.phone,
            city: receipt.business.city,
            state: receipt.business.state,
            country: receipt.business.country,
            logoUrl: receipt.business.logoUrl,
          },
          client: {
            name: receipt.name || "Client",
            email: receipt.email,
            phone: receipt.phone,
          },
          items: receipt.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice.toString(),
            total: item.total.toString(),
          })),
        });

        // Upload to Cloudinary
        const uploadResult = await cloudinaryService.uploadImage(pdfBuffer, {
          filename: `${receipt.receiptNumber}.pdf`,
          folder: `sara/businesses/${business.id}/receipts`,
          mime_type: "application/pdf",
          public_id: receipt.id,
          resource_type: "raw",
        });

        // Update receipt with URL
        const updatedReceipt = await tx.receipt.update({
          where: { id: receipt.id },
          data: { url: uploadResult.secure_url },
        });

        return updatedReceipt;
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
        items: true,
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

import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import {
  updateReceiptValidatorSchema,
  type UpdateReceiptValidatorSchema,
} from "@/backend/validators/receipt.validator";
import { db } from "@/server/db";
import { type ApiResponse, type ReceiptListItem } from "types";
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { type Receipt, type Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { cloudinaryService } from "@/backend/services/cloudinary";
import { generateReceiptPdf } from "@/backend/services/pdf";

const receiptInclude: Prisma.ReceiptInclude = {
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

/**
 * @body UpdateReceiptValidatorSchema
 * @pathParams slugParamValidator
 * @description Updates an existing receipt for the authenticated user's business.
 * @contentType application/json
 * @auth bearer
 */
export const PUT = withMiddleware<UpdateReceiptValidatorSchema>(
  async (request, { params }) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;
      const { slug } = params;

      const existingReceipt = await db.receipt.findUnique({
        where: { slug },
        include: { business: true },
      });

      if (!existingReceipt) {
        throw new NotFoundException("Receipt not found");
      }

      if (existingReceipt.business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You are not authorized to update this receipt",
        );
      }

      const updatedReceiptResult = await db.$transaction(async (tx) => {
        const data: Prisma.ReceiptUpdateInput = {};

        if (payload.name !== undefined) data.name = payload.name ?? null;
        if (payload.email !== undefined) data.email = payload.email ?? null;
        if (payload.phone !== undefined) data.phone = payload.phone ?? null;
        if (payload.currency !== undefined) data.currency = payload.currency;
        if (payload.subtotal !== undefined) data.subtotal = payload.subtotal;
        if (payload.taxAmount !== undefined) data.taxAmount = payload.taxAmount;
        if (payload.discount !== undefined) data.discount = payload.discount;
        if (payload.total !== undefined) data.total = payload.total;
        if (payload.amountPaid !== undefined)
          data.amountPaid = payload.amountPaid;
        if (payload.paymentMethod !== undefined)
          data.paymentMethod = payload.paymentMethod;
        if (payload.notes !== undefined) data.notes = payload.notes ?? null;

        if (payload.paymentId) {
          data.payment = { connect: { id: payload.paymentId } };
        } else if (payload.paymentId === null) {
          data.payment = { disconnect: true };
        }

        if (payload.items) {
          // Delete existing items and create new ones for a full replacement
          await tx.receiptItem.deleteMany({
            where: { receiptId: existingReceipt.id },
          });

          if (payload.items && payload.items.length > 0) {
            data.items = {
              create: payload.items.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total,
              })),
            };
          }
        }

        const receipt = await tx.receipt.update({
          where: { id: existingReceipt.id },
          data,
          include: { business: true, items: true },
        });

        // Regenerate PDF with updated data
        const pdfBuffer = await generateReceiptPdf({
          receiptNumber: receipt.receiptNumber,
          paymentMethod: receipt.paymentMethod,
          currency: receipt.currency,
          subtotal: receipt.subtotal.toString(),
          taxAmount: receipt.taxAmount.toString(),
          discount: receipt.discount.toString(),
          total: receipt.total.toString(),
          amountPaid: receipt.amountPaid.toString(),
          paidAt: receipt.createdAt,
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

        // Upload new version to Cloudinary
        const uploadResult = await cloudinaryService.uploadImage(pdfBuffer, {
          filename: `${receipt.receiptNumber}.pdf`,
          folder: `sara/businesses/${receipt.businessId}/receipts`,
          mime_type: "application/pdf",
          public_id: receipt.id,
          resource_type: "raw",
        });

        // Update receipt with potentially new URL (if public_id handling differs)
        const finalReceipt = await tx.receipt.update({
          where: { id: receipt.id },
          data: { url: uploadResult.secure_url },
        });

        return finalReceipt;
      });

      const response: ApiResponse<Receipt> = {
        status: 200,
        message: "Receipt updated successfully",
        data: updatedReceiptResult,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while updating receipt: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(updateReceiptValidatorSchema)],
);

/**
 * @pathParams slugParamValidator
 * @description Deletes an existing receipt for the authenticated user's business.
 * @auth bearer
 */
export const DELETE = withMiddleware<unknown>(
  async (request, { params }) => {
    try {
      const user = request.user!;
      const { slug } = params;

      const receipt = await db.receipt.findUnique({
        where: { slug },
        include: { business: { select: { ownerId: true } } },
      });

      if (!receipt) {
        throw new NotFoundException("Receipt not found");
      }

      if (receipt.business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You are not authorized to delete this receipt",
        );
      }

      const deletedReceipt = await db.receipt.delete({
        where: { slug },
      });

      const response: ApiResponse<Receipt> = {
        status: 200,
        message: "Receipt deleted successfully",
        data: deletedReceipt,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while deleting receipt: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

/**
 * @pathParams slugParamValidator
 * @description Retrieves a single receipt by slug for the authenticated user's business.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request, { params }) => {
    try {
      const user = request.user!;
      const { slug } = params;

      const receipt = await db.receipt.findUnique({
        where: { slug },
        include: receiptInclude,
      });

      if (!receipt) {
        throw new NotFoundException("Receipt not found");
      }

      if (receipt.business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You are not authorized to view this receipt",
        );
      }

      const response: ApiResponse<ReceiptListItem> = {
        status: 200,
        message: "Receipt retrieved successfully",
        data: receipt as unknown as ReceiptListItem,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching receipt: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

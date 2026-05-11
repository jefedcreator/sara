import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from '@/backend/middleware';
import {
  updateReceiptValidatorSchema,
  type UpdateReceiptValidatorSchema,
} from '@/backend/validators/receipt.validator';
import { db } from '@/server/db';
import { type ApiResponse, type ReceiptListItem } from 'types';
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@/utils/exceptions';
import { type Receipt, type Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';

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
};

/**
 * @body UpdateReceiptValidatorSchema
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

      const receipt = await db.receipt.findUnique({
        where: { slug },
        include: { business: { select: { ownerId: true } } },
      });

      if (!receipt) {
        throw new NotFoundException('Receipt not found');
      }

      if (receipt.business.ownerId !== user.id) {
        throw new ForbiddenException(
          'You are not authorized to update this receipt'
        );
      }

      const data: Prisma.ReceiptUpdateInput = {};

      if (payload.clientName !== undefined) data.clientName = payload.clientName ?? null;
      if (payload.clientEmail !== undefined) data.clientEmail = payload.clientEmail ?? null;
      if (payload.clientPhone !== undefined) data.clientPhone = payload.clientPhone ?? null;
      if (payload.receiptNumber) data.receiptNumber = payload.receiptNumber;

      if (payload.paymentId) {
        data.payment = { connect: { id: payload.paymentId } };
      }

      const updatedReceipt = await db.receipt.update({
        where: { slug },
        data,
        include: receiptInclude,
      });

      const response: ApiResponse<ReceiptListItem> = {
        status: 200,
        message: 'Receipt updated successfully',
        data: updatedReceipt,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while updating receipt: ${error.message}`
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(updateReceiptValidatorSchema)]
);

/**
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
        throw new NotFoundException('Receipt not found');
      }

      if (receipt.business.ownerId !== user.id) {
        throw new ForbiddenException(
          'You are not authorized to delete this receipt'
        );
      }

      const deletedReceipt = await db.receipt.delete({
        where: { slug },
      });

      const response: ApiResponse<Receipt> = {
        status: 200,
        message: 'Receipt deleted successfully',
        data: deletedReceipt,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while deleting receipt: ${error.message}`
      );
    }
  },
  [authMiddleware]
);

/**
 * @description Retrieves a single receipt by slug.
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
        throw new NotFoundException('Receipt not found');
      }

      if (receipt.business.ownerId !== user.id) {
        throw new ForbiddenException(
          'You are not authorized to view this receipt'
        );
      }

      const response: ApiResponse<ReceiptListItem> = {
        status: 200,
        message: 'Receipt retrieved successfully',
        data: receipt,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching receipt: ${error.message}`
      );
    }
  },
  [authMiddleware]
);

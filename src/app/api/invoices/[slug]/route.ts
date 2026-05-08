import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from '@/backend/middleware';
import {
  updateInvoiceValidatorSchema,
  type UpdateInvoiceValidatorSchema,
} from '@/backend/validators/invoice.validator';
import { db } from '@/server/db';
import { type ApiResponse, type InvoiceListItem } from 'types';
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@/utils/exceptions';
import { type Invoice, type Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';

/**
 * @body UpdateInvoiceValidatorSchema
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
        throw new NotFoundException('Invoice not found');
      }

      if (invoice.business.ownerId !== user.id) {
        throw new ForbiddenException(
          'You are not authorized to update this invoice'
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
      if (payload.amountPaid !== undefined) data.amountPaid = payload.amountPaid;
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

      const updatedInvoice = await db.invoice.update({
        where: { slug },
        data,
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

      const response: ApiResponse<InvoiceListItem> = {
        status: 200,
        message: 'Invoice updated successfully',
        data: updatedInvoice,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while updating invoice: ${error.message}`
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(updateInvoiceValidatorSchema)]
);

/**
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
        throw new NotFoundException('Invoice not found');
      }

      if (invoice.business.ownerId !== user.id) {
        throw new ForbiddenException(
          'You are not authorized to delete this invoice'
        );
      }

      const deletedInvoice = await db.invoice.delete({
        where: { slug },
      });

      const response: ApiResponse<Invoice> = {
        status: 200,
        message: 'Invoice deleted successfully',
        data: deletedInvoice,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while deleting invoice: ${error.message}`
      );
    }
  },
  [authMiddleware]
);

/**
 * @description Retrieves a single invoice by slug.
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
        throw new NotFoundException('Invoice not found');
      }

      if (invoice.business.ownerId !== user.id) {
        throw new ForbiddenException(
          'You are not authorized to view this invoice'
        );
      }

      const response: ApiResponse<InvoiceListItem> = {
        status: 200,
        message: 'Invoice retrieved successfully',
        data: invoice,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching invoice: ${error.message}`
      );
    }
  },
  [authMiddleware]
);

import { cloudinaryService } from "@/backend/services/cloudinary";
import { customerService } from "@/backend/services/customer";
import {
  resolveDocumentLines,
  type DocumentLineInput,
} from "@/backend/services/lines";
import { orderService, type OrderFulfilmentInput } from "@/backend/services/order";
import { generateReceiptPdf } from "@/backend/services/pdf";
import { db } from "@/server/db";
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { Prisma, type PaymentMethod, type Receipt } from "@prisma/client";
import slugify from "slugify";

export type CreateReceiptInput = {
  businessId: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  currency: string;
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;
  amountPaid: number;
  paymentMethod?: PaymentMethod | null;
  notes?: string | null;
  paymentId?: string | null;
  customerId?: string | null;
  lines?: DocumentLineInput[];
  /** How the products on a walk-in receipt reach the customer. Defaults to pickup. */
  sale?: OrderFulfilmentInput;
};

class ReceiptService {
  async create(input: CreateReceiptInput): Promise<Receipt> {
    const receipt = await db.$transaction(async (tx) => {
      const business = await tx.business.findUnique({
        where: { id: input.businessId },
      });
      if (!business) throw new NotFoundException("Business not found");

      let linesToCreate = input.lines ?? [];

      if (input.paymentId) {
        const payment = await tx.payment.findFirst({
          where: { id: input.paymentId, businessId: business.id },
          include: {
            receipt: { select: { id: true } },
            invoice: {
              include: { lines: { orderBy: { position: "asc" } } },
            },
          },
        });
        if (!payment) throw new BadRequestException("Payment not found for this business");
        if (payment.receipt) {
          throw new ConflictException("A receipt already exists for this payment");
        }
        if (linesToCreate.length === 0 && payment.invoice?.lines) {
          linesToCreate = payment.invoice.lines.map((line) => ({
            serviceId: line.serviceId,
            productOptionId: line.productOptionId,
            name: line.name,
            description: line.description,
            quantity: line.quantity,
            unitPrice: Number(line.unitPrice),
            total: Number(line.total),
          }));
        }
      }

      const resolvedLines = await resolveDocumentLines(
        tx,
        business.id,
        linesToCreate,
      );

      const customer = input.customerId
        ? await customerService.ownedBy(tx, business.id, input.customerId)
        : await customerService.resolve(tx, {
            businessId: business.id,
            name: input.name,
            phone: input.phone,
            email: input.email,
          });

      const lastReceipt = await tx.receipt.findFirst({
        where: { businessId: business.id },
        orderBy: { createdAt: "desc" },
        select: { receiptNumber: true },
      });
      let receiptNumber = "RCP-1001";
      if (lastReceipt && lastReceipt.receiptNumber.startsWith("RCP-")) {
        const n = parseInt(lastReceipt.receiptNumber.replace("RCP-", ""), 10);
        receiptNumber = `RCP-${isNaN(n) ? 1001 : n + 1}`;
      }

      const createData: Prisma.ReceiptUncheckedCreateInput = {
        businessId: business.id,
        customerId: customer?.id ?? null,
        slug: slugify(`${business.name}-${receiptNumber}`, { lower: true, strict: true }),
        receiptNumber,
        name: input.name ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        currency: input.currency,
        subtotal: input.subtotal,
        taxAmount: input.taxAmount,
        discount: input.discount,
        total: input.total,
        amountPaid: input.amountPaid,
        paymentMethod: input.paymentMethod ?? null,
        notes: input.notes ?? null,
        paymentId: input.paymentId ?? null,
      };
      if (resolvedLines.length > 0) {
        createData.lines = { create: resolvedLines };
      }

      const receipt = await tx.receipt.create({
        data: createData,
        include: {
          business: true,
          lines: { include: { service: true }, orderBy: { position: "asc" } },
        },
      });
      if (!receipt.business) {
        throw new InternalServerErrorException(
          "Failed to retrieve business details for the receipt",
        );
      }

      // A receipt for an existing payment (an invoice's or an online order's)
      // already has its order. Any other receipt that sold products is a sale
      // that just happened, so it becomes an order and takes the stock.
      if (!input.paymentId) {
        await orderService.createFromReceipt(
          tx,
          {
            id: receipt.id,
            businessId: business.id,
            customerId: customer?.id ?? null,
            currency: receipt.currency,
            name: receipt.name,
            phone: receipt.phone,
            email: receipt.email,
            amountPaid: Number(receipt.amountPaid),
            paymentMethod: receipt.paymentMethod,
            lines: resolvedLines,
          },
          input.sale ?? { fulfilment: "PICKUP" },
        );
      }

      return receipt;
    });

    let pdfUrl: string | null = null;
    try {
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
        items: receipt.lines.map((item) => ({
          description: item.description || item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          total: item.total.toString(),
        })),
      });

      const uploadResult = await cloudinaryService.uploadImage(pdfBuffer, {
        filename: `${receipt.receiptNumber}.pdf`,
        folder: `sara/businesses/${receipt.business.id}/receipts`,
        mime_type: "application/pdf",
        public_id: receipt.id,
        resource_type: "raw",
      });

      pdfUrl = uploadResult.secure_url;
    } catch (error) {
      console.error(`Failed to generate or upload receipt PDF for ${receipt.id}:`, error);
    }

    if (pdfUrl) {
      return db.receipt.update({
        where: { id: receipt.id },
        data: { url: pdfUrl },
      });
    }

    return receipt;
  }
}

export const receiptService = new ReceiptService();

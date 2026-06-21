import { cloudinaryService } from "@/backend/services/cloudinary";
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
  services?: Array<{
    serviceId: string;
    description?: string | null;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
};

class ReceiptService {
  async create(input: CreateReceiptInput): Promise<Receipt> {
    return db.$transaction(async (tx) => {
      const business = await tx.business.findUnique({
        where: { id: input.businessId },
      });
      if (!business) throw new NotFoundException("Business not found");

      let servicesToCreate = input.services ?? [];

      if (input.paymentId) {
        const payment = await tx.payment.findFirst({
          where: { id: input.paymentId, businessId: business.id },
          include: {
            receipt: { select: { id: true } },
            invoice: { include: { services: true } },
          },
        });
        if (!payment) throw new BadRequestException("Payment not found for this business");
        if (payment.receipt) {
          throw new ConflictException("A receipt already exists for this payment");
        }
        if (servicesToCreate.length === 0 && payment.invoice?.services) {
          servicesToCreate = payment.invoice.services.map((s) => ({
            serviceId: s.serviceId,
            description: s.description ?? undefined,
            quantity: s.quantity,
            unitPrice: Number(s.unitPrice),
            total: Number(s.total),
          }));
        }
      }

      if (servicesToCreate.length > 0) {
        const serviceIds = Array.from(new Set(servicesToCreate.map((s) => s.serviceId)));
        const services = await tx.service.findMany({
          where: { id: { in: serviceIds }, businessId: business.id },
          select: { id: true },
        });
        if (services.length !== serviceIds.length) {
          throw new BadRequestException(
            "One or more services do not belong to this business",
          );
        }
      }

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

      const createData: Prisma.ReceiptCreateInput = {
        business: { connect: { id: business.id } },
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
      };
      if (input.paymentId) createData.payment = { connect: { id: input.paymentId } };
      if (servicesToCreate.length > 0) {
        createData.services = {
          create: servicesToCreate.map((item) => ({
            serviceId: item.serviceId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
          })),
        };
      }

      const receipt = await tx.receipt.create({
        data: createData,
        include: { business: true, services: { include: { service: true } } },
      });
      if (!receipt.business) {
        throw new InternalServerErrorException(
          "Failed to retrieve business details for the receipt",
        );
      }

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
        items: receipt.services.map((item) => ({
          description: item.description || item.service.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          total: item.total.toString(),
        })),
      });

      const uploadResult = await cloudinaryService.uploadImage(pdfBuffer, {
        filename: `${receipt.receiptNumber}.pdf`,
        folder: `sara/businesses/${business.id}/receipts`,
        mime_type: "application/pdf",
        public_id: receipt.id,
        resource_type: "raw",
      });

      return tx.receipt.update({
        where: { id: receipt.id },
        data: { url: uploadResult.secure_url },
      });
    });
  }
}

export const receiptService = new ReceiptService();

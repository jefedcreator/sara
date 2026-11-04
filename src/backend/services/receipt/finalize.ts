import { cloudinaryService } from "@/backend/services/cloudinary";
import { generateReceiptPdf } from "@/backend/services/pdf";
import { db } from "@/server/db";
import { NotFoundException } from "@/utils/exceptions";
import type { Prisma } from "@prisma/client";

export const receiptInclude = {
  business: true,
  lines: { include: { service: true }, orderBy: { position: "asc" } },
} satisfies Prisma.ReceiptInclude;

export type CreatedReceipt = Prisma.ReceiptGetPayload<{
  include: typeof receiptInclude;
}>;

/** Generate and store the PDF only after the document transaction commits. */
export async function finalizeReceipt(id: string): Promise<void> {
  const receipt = await db.receipt.findUnique({
    where: { id },
    include: receiptInclude,
  });
  if (!receipt) throw new NotFoundException("Receipt not found");

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
    await db.receipt.update({
      where: { id: receipt.id },
      data: { url: pdfUrl },
    });
  }
}

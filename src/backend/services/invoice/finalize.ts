import { cloudinaryService } from "@/backend/services/cloudinary";
import { generateInvoicePdf } from "@/backend/services/pdf";
import { db } from "@/server/db";
import { NotFoundException } from "@/utils/exceptions";
import type { Prisma } from "@prisma/client";

export const invoiceInclude = {
  business: true,
  lines: { include: { service: true }, orderBy: { position: "asc" } },
} satisfies Prisma.InvoiceInclude;

export type CreatedInvoice = Prisma.InvoiceGetPayload<{
  include: typeof invoiceInclude;
}>;

/** Generate and store the PDF only after the document transaction commits. */
export async function finalizeInvoice(id: string): Promise<void> {
  const invoice = await db.invoice.findUnique({
    where: { id },
    include: invoiceInclude,
  });
  if (!invoice) throw new NotFoundException("Invoice not found");

  let pdfUrl: string | null = null;
  try {
    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      currency: invoice.currency,
      subtotal: invoice.subtotal.toString(),
      taxAmount: invoice.taxAmount.toString(),
      discount: invoice.discount.toString(),
      total: invoice.total.toString(),
      amountPaid: invoice.amountPaid.toString(),
      dueAt: invoice.dueAt,
      sentAt: invoice.sentAt,
      paidAt: invoice.paidAt,
      notes: invoice.notes,
      business: {
        name: invoice.business.name,
        email: invoice.business.email,
        phone: invoice.business.phone,
        city: invoice.business.city,
        state: invoice.business.state,
        country: invoice.business.country,
        logoUrl: invoice.business.logoUrl,
      },
      client: {
        name: invoice.clientName,
        email: invoice.clientEmail,
        phone: invoice.clientPhone,
      },
      items: invoice.lines.map((item) => ({
        description: item.description || item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        total: item.total.toString(),
      })),
    });

    const uploadResult = await cloudinaryService.uploadImage(pdfBuffer, {
      filename: `${invoice.invoiceNumber}.pdf`,
      folder: `sara/businesses/${invoice.business.id}/invoices`,
      mime_type: "application/pdf",
      public_id: invoice.id,
      resource_type: "raw",
    });

    pdfUrl = uploadResult.secure_url;
  } catch (error) {
    console.error(`Failed to generate or upload invoice PDF for ${invoice.id}:`, error);
  }

  if (pdfUrl) {
    await db.invoice.update({
      where: { id: invoice.id },
      data: { url: pdfUrl },
    });
  }
}

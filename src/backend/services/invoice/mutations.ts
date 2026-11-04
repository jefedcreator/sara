import { Prisma, type Invoice } from "@prisma/client";
import { withSerializable } from "@/backend/services/assistant/transaction";
import type { Effect } from "@/backend/services/assistant/types";
import { customerService } from "@/backend/services/customer";
import { emailInvoice } from "@/backend/services/email/documents";
import { resolveDocumentLines } from "@/backend/services/lines";
import { orderService } from "@/backend/services/order";
import { finalizeReceipt, receiptService } from "@/backend/services/receipt";
import type { UpdateInvoiceValidatorSchema } from "@/backend/validators/invoice.validator";
import { db } from "@/server/db";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";
import { finalizeInvoice, invoiceInclude, type CreatedInvoice } from "./finalize";

export type InvoiceMutation = { invoice: CreatedInvoice; effects: Effect[] };
export type RecordInvoicePaymentInput = {
  /** Additional whole minor units, never the invoice's cumulative amountPaid. */
  amountMinor: number;
  method: "CASH" | "BANK_TRANSFER";
  createReceipt: boolean;
  paidAt: Date;
};

const PAYMENT_FIELDS = new Set(["status", "amountPaid", "paidAt", "cancelOrder"]);

function invoiceEffects(invoice: CreatedInvoice): Effect[] {
  const effects: Effect[] = [{ kind: "invoice_pdf", id: invoice.id }];
  if ((invoice.status === "SENT" || invoice.status === "OVERDUE") && invoice.clientEmail) {
    effects.push({ kind: "invoice_email", id: invoice.id });
  }
  return effects;
}

class InvoiceMutations {
  async update(
    businessId: string,
    slug: string,
    patch: UpdateInvoiceValidatorSchema,
  ): Promise<Invoice> {
    const mutation = await withSerializable((tx) =>
      this.updateInTransaction(tx, businessId, slug, patch),
    );
    await this.finalize(mutation.effects);
    return (await db.invoice.findUnique({ where: { id: mutation.invoice.id } })) ?? mutation.invoice;
  }

  /** Legacy web edits retain cumulative amountPaid; no payment method is inferred. */
  async updateInTransaction(
    tx: Prisma.TransactionClient,
    businessId: string,
    slug: string,
    patch: UpdateInvoiceValidatorSchema,
  ): Promise<InvoiceMutation> {
    const invoice = await tx.invoice.findFirst({
      where: { slug, businessId },
      include: invoiceInclude,
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (invoice.status === "PAID") throw new BadRequestException("Invoice cannot be updated");
    if (invoice.status === "PARTIALLY_PAID" && Object.keys(patch).some((key) => !PAYMENT_FIELDS.has(key))) {
      throw new BadRequestException("A part-paid invoice can only record further payments");
    }

    const currentPaid = new Prisma.Decimal(invoice.amountPaid);
    const total = new Prisma.Decimal(patch.total ?? invoice.total);
    const paid = new Prisma.Decimal(patch.amountPaid ?? currentPaid);
    if (!total.isFinite() || !paid.isFinite() || paid.isNegative() || paid.gt(total)) {
      throw new BadRequestException("amountPaid cannot exceed the invoice total");
    }
    if (paid.lt(currentPaid)) {
      throw new BadRequestException("amountPaid cannot be reduced");
    }
    if (invoice.status === "VOID" && paid.gt(currentPaid)) {
      throw new BadRequestException("A void invoice cannot record further payments");
    }

    const data: Prisma.InvoiceUpdateInput = {};
    if (patch.name) data.clientName = patch.name;
    if (patch.email !== undefined) data.clientEmail = patch.email ?? null;
    if (patch.phone !== undefined) data.clientPhone = patch.phone ?? null;
    if (patch.status) data.status = patch.status;
    if (patch.currency) data.currency = patch.currency;
    if (patch.subtotal !== undefined) data.subtotal = patch.subtotal;
    if (patch.taxAmount !== undefined) data.taxAmount = patch.taxAmount;
    if (patch.discount !== undefined) data.discount = patch.discount;
    if (patch.total !== undefined) data.total = patch.total;
    if (patch.amountPaid !== undefined) data.amountPaid = patch.amountPaid;
    if (patch.dueAt !== undefined) data.dueAt = patch.dueAt ?? null;
    if (patch.sentAt !== undefined) data.sentAt = patch.sentAt ?? null;
    if (patch.paidAt !== undefined) data.paidAt = patch.paidAt ?? null;
    if (patch.notes !== undefined) data.notes = patch.notes ?? null;
    if (patch.bookingId !== undefined) {
      if (patch.bookingId) {
        const booking = await tx.booking.findFirst({ where: { id: patch.bookingId, businessId } });
        if (!booking) throw new BadRequestException("Booking not found for this business");
      }
      data.booking = patch.bookingId ? { connect: { id: patch.bookingId } } : { disconnect: true };
    }
    if (patch.customerId !== undefined) {
      if (patch.customerId) await customerService.ownedBy(tx, businessId, patch.customerId);
      data.customer = patch.customerId ? { connect: { id: patch.customerId } } : { disconnect: true };
    }
    if (patch.lines) {
      data.lines = { deleteMany: {}, create: await resolveDocumentLines(tx, businessId, patch.lines) };
    }

    const updated = await tx.invoice.update({ where: { id: invoice.id }, data, include: invoiceInclude });
    if (currentPaid.isZero() && paid.gt(0)) {
      await orderService.createFromInvoice(tx, invoice.id);
    }
    const effects = invoiceEffects(updated);
    if (patch.status === "VOID" && patch.cancelOrder) {
      const order = await tx.order.findUnique({
        where: { invoiceId: invoice.id },
        select: { slug: true, status: true },
      });
      if (order && (order.status === "NEW" || order.status === "READY")) {
        const cancelled = await orderService.setStatusInTransaction(tx, businessId, order.slug, "CANCELLED");
        effects.push(...cancelled.effects);
      }
    }
    return { invoice: updated, effects };
  }

  /**
   * The caller supplies a serializable transaction. Assistant orchestration must
   * requireAvailableStock before the first payment when product lines exist;
   * createFromInvoice itself keeps permissive verified-online-payment behavior.
   */
  async recordPaymentInTransaction(
    tx: Prisma.TransactionClient,
    businessId: string,
    invoiceId: string,
    input: RecordInvoicePaymentInput,
  ): Promise<InvoiceMutation & { receiptId: string | null }> {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new BadRequestException("Payment must be a positive whole number of minor units");
    }
    if (input.method !== "CASH" && input.method !== "BANK_TRANSFER") {
      throw new BadRequestException("Choose cash or bank transfer for a manual payment");
    }
    if (!(input.paidAt instanceof Date) || !Number.isFinite(input.paidAt.getTime())) {
      throw new BadRequestException("Enter a valid payment date");
    }
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, businessId },
      include: invoiceInclude,
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (invoice.status === "PAID" || invoice.status === "VOID") {
      throw new BadRequestException("This invoice cannot record further payments");
    }
    const currentPaid = new Prisma.Decimal(invoice.amountPaid);
    const currentTotal = new Prisma.Decimal(invoice.total);
    const amount = new Prisma.Decimal(input.amountMinor).div(100);
    const outstanding = currentTotal.minus(currentPaid);
    if (amount.gt(outstanding)) throw new BadRequestException("Payment cannot exceed the outstanding balance");
    const nextPaid = currentPaid.plus(amount);
    const status = nextPaid.eq(currentTotal) ? "PAID" : "PARTIALLY_PAID";
    const payment = await tx.payment.create({
      data: {
        businessId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount,
        method: input.method,
        clientName: invoice.clientName,
        clientEmail: invoice.clientEmail,
        clientPhone: invoice.clientPhone,
      },
    });
    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: nextPaid, status, paidAt: status === "PAID" ? input.paidAt : null },
      include: invoiceInclude,
    });
    if (currentPaid.isZero()) await orderService.createFromInvoice(tx, invoice.id);

    let receiptId: string | null = null;
    const effects = invoiceEffects(updated);
    if (input.createReceipt) {
      const receipt = await receiptService.createInTransaction(tx, {
        businessId,
        customerId: invoice.customerId,
        paymentId: payment.id,
        name: invoice.clientName,
        email: invoice.clientEmail,
        phone: invoice.clientPhone,
        currency: invoice.currency,
        subtotal: amount.toNumber(),
        taxAmount: 0,
        discount: 0,
        total: amount.toNumber(),
        amountPaid: amount.toNumber(),
        paymentMethod: input.method,
      });
      receiptId = receipt.id;
      effects.push({ kind: "receipt_pdf", id: receipt.id });
    }
    return { invoice: updated, receiptId, effects };
  }

  /** Run only after commit; every finalizer reloads through the global client. */
  async finalize(effects: Effect[]): Promise<void> {
    for (const effect of effects) {
      if (effect.kind === "invoice_pdf") await finalizeInvoice(effect.id);
      if (effect.kind === "receipt_pdf") await finalizeReceipt(effect.id);
      if (effect.kind === "order_email") await orderService.finalizeStatus(effect.id);
      if (effect.kind === "invoice_email") {
        const invoice = await db.invoice.findUnique({ where: { id: effect.id }, include: invoiceInclude });
        if (invoice && (invoice.status === "SENT" || invoice.status === "OVERDUE") && invoice.clientEmail) {
          await emailInvoice(invoice, invoice.business);
        }
      }
    }
  }
}

export const invoiceMutations = new InvoiceMutations();

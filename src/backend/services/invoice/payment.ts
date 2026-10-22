import { isSerializationFailure } from "@/backend/services/booking/conflicts";
import { emailReceipt } from "@/backend/services/email/documents";
import { formatMoney } from "@/backend/services/messaging/engine/amount";
import { ownerNotifier } from "@/backend/services/messaging/notify";
import { orderService } from "@/backend/services/order";
import {
  paystackService,
  type SuccessfulPaymentData,
} from "@/backend/services/paystack";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";
import { appBaseUrl } from "@/utils/url";
import { Prisma, type InvoiceStatus } from "@prisma/client";

const NOT_PAYABLE = "This invoice can't be paid online";
const PAYMENT_SETUP =
  "This business has not set up payment processing. Please contact the service provider.";

/** Only an invoice that has been sent and still owes money can be paid. */
const PAYABLE_STATUSES = ["SENT", "PARTIALLY_PAID", "OVERDUE"];

const isUniqueConstraint = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "P2002";

/** Whole kobo, so decimal money never leaks float noise into a charge. */
const toKobo = (amount: number) => Math.round(amount * 100);

/** The only relation a duplicate reference needs to send the customer back. */
type ExistingPayment = {
  invoice: { publicId: string } | null;
};

class InvoicePayments {
  /**
   * Start a Paystack charge for an invoice's whole remaining balance. The
   * customer comes back to the invoice page (`?i=<publicId>`) afterwards.
   */
  async start(publicId: string): Promise<{ paymentUrl: string }> {
    const invoice = await db.invoice.findUnique({
      where: { publicId },
      select: {
        id: true,
        publicId: true,
        invoiceNumber: true,
        status: true,
        clientName: true,
        clientEmail: true,
        total: true,
        amountPaid: true,
        business: {
          select: {
            id: true,
            name: true,
            paystackSubaccountCode: true,
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");

    const balance = toKobo(Number(invoice.total) - Number(invoice.amountPaid));
    if (!PAYABLE_STATUSES.includes(invoice.status) || balance <= 0) {
      throw new BadRequestException(NOT_PAYABLE);
    }
    if (!invoice.business.paystackSubaccountCode) {
      throw new BadRequestException(PAYMENT_SETUP);
    }

    const transaction = await paystackService.initializeTransaction({
      email: invoice.clientEmail || "customer@sara.app",
      amount: balance,
      subaccountCode: invoice.business.paystackSubaccountCode,
      callbackUrl: `${appBaseUrl()}/api/webhooks/paystack?i=${encodeURIComponent(invoice.publicId)}`,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        businessId: invoice.business.id,
        businessName: invoice.business.name,
        clientName: invoice.clientName,
      },
      bearer: "account",
    });

    return { paymentUrl: transaction.authorization_url };
  }

  /**
   * Record a paid invoice charge.
   *
   * The reference is the idempotency key: a webhook and a callback
   * verification for the same charge produce one Payment, one receipt and one
   * alert. The Payment and the invoice's new balance, status and `paidAt`
   * commit in one serializable transaction, and a lost race on the unique
   * reference lands on the winner's result instead of recording twice.
   *
   * The order (for invoices that list products), receipt, owner alert and
   * receipt email follow and are best effort: a failure there must not lose
   * the payment.
   */
  async process(
    data: SuccessfulPaymentData,
  ): Promise<{ invoice: { publicId: string } } | null> {
    const { reference, amount, metadata } = data;

    const existing: ExistingPayment | null = await db.payment.findUnique({
      where: { reference },
      select: { invoice: { select: { publicId: true } } },
    });
    if (existing) {
      console.log(
        `[Paystack Webhook] Duplicate event — payment with reference ${reference} already exists. Skipping.`,
      );
      return existing.invoice ? { invoice: existing.invoice } : null;
    }

    const invoiceId =
      typeof metadata?.invoiceId === "string" ? metadata.invoiceId : undefined;
    if (!invoiceId) {
      console.warn(
        `[Paystack Webhook] charge.success missing an invoice in metadata. Reference: ${reference}`,
      );
      return null;
    }

    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        business: { select: { id: true, name: true, email: true } },
      },
    });
    if (!invoice) {
      console.warn(
        `[Paystack Webhook] Invoice ${invoiceId} not found. Reference: ${reference}`,
      );
      return null;
    }

    const businessId = metadata?.businessId;
    if (typeof businessId !== "string" || businessId !== invoice.businessId) {
      console.warn(
        `[Paystack Webhook] Business mismatch — invoice ${invoiceId} belongs to ${invoice.businessId}, but metadata says ${String(businessId)}. Reference: ${reference}`,
      );
      return null;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      console.warn(
        `[Paystack Webhook] Invalid amount ${amount} for invoice ${invoiceId}. Reference: ${reference}`,
      );
      return null;
    }

    const paid = amount / 100;

    const record = () =>
      db.$transaction(
        async (tx) => {
          // Read the balance inside the transaction so two part payments
          // landing together add up instead of overwriting each other.
          const fresh = await tx.invoice.findUnique({
            where: { id: invoice.id },
            select: { total: true, amountPaid: true, status: true },
          });
          const total = Number(fresh?.total ?? invoice.total);
          const amountPaid =
            Math.round(
              (Number(fresh?.amountPaid ?? invoice.amountPaid) + paid) * 100,
            ) / 100;
          const status = fresh?.status ?? invoice.status;
          const settled = amountPaid >= total;

          const payment = await tx.payment.create({
            data: {
              businessId: invoice.businessId,
              invoiceId: invoice.id,
              customerId: invoice.customerId,
              amount: paid,
              method: "PAYSTACK",
              reference,
              clientName: invoice.clientName,
              clientEmail: invoice.clientEmail,
              clientPhone: invoice.clientPhone,
            },
          });

          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              amountPaid,
              // A void invoice keeps its status; the money is still recorded.
              ...(status === "VOID"
                ? {}
                : {
                    status: (settled ? "PAID" : "PARTIALLY_PAID") as InvoiceStatus,
                    ...(settled ? { paidAt: new Date() } : {}),
                  }),
            },
          });

          return payment;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

    let payment: Awaited<ReturnType<typeof record>>;
    try {
      payment = await record();
    } catch (error) {
      // A webhook and the callback verification can race: both pass the check
      // above, one wins the unique reference, the other lands here.
      if (isUniqueConstraint(error)) {
        const winner: ExistingPayment | null = await db.payment.findUnique({
          where: { reference },
          select: { invoice: { select: { publicId: true } } },
        });
        if (winner) return winner.invoice ? { invoice: winner.invoice } : null;
      }

      if (!isSerializationFailure(error) && !isUniqueConstraint(error)) {
        throw error;
      }

      try {
        payment = await record();
      } catch (retryError) {
        if (!isUniqueConstraint(retryError)) throw retryError;
        const winner: ExistingPayment | null = await db.payment.findUnique({
          where: { reference },
          select: { invoice: { select: { publicId: true } } },
        });
        if (winner) return winner.invoice ? { invoice: winner.invoice } : null;
        throw retryError;
      }
    }

    // Best effort: the first money against an invoice that lists products
    // makes the order and takes the stock. It is idempotent, so a later part
    // payment finds the order already there.
    try {
      await orderService.createFromInvoice(db, invoice.id);
    } catch (error) {
      console.warn("[Paystack Webhook] Invoice order creation failed:", error);
    }

    // Best effort: the automatic receipt; it copies the invoice's lines.
    try {
      const receipt = await receiptService.create({
        businessId: invoice.businessId,
        customerId: invoice.customerId,
        paymentId: payment.id,
        name: invoice.clientName,
        email: invoice.clientEmail,
        phone: invoice.clientPhone,
        currency: invoice.currency,
        subtotal: paid,
        taxAmount: 0,
        discount: 0,
        total: paid,
        amountPaid: paid,
        paymentMethod: "PAYSTACK",
      });
      await emailReceipt(receipt, invoice.business);
    } catch (error) {
      console.warn("[Paystack Webhook] Receipt creation failed:", error);
    }

    // Best effort: alert the owner on their linked chat channel(s).
    try {
      await ownerNotifier.notify(
        invoice.businessId,
        `💳 ${invoice.invoiceNumber} paid · ${invoice.clientName} · ${formatMoney(paid, invoice.currency)}`,
      );
    } catch (error) {
      console.warn("[Paystack Webhook] Owner notification failed:", error);
    }

    return { invoice: { publicId: invoice.publicId } };
  }
}

export const invoicePayments = new InvoicePayments();

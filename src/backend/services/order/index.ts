import { holdExpiresFrom, isSerializationFailure } from "@/backend/services/booking/conflicts";
import { customerService } from "@/backend/services/customer";
import { emailService } from "@/backend/services/email";
import { paystackService } from "@/backend/services/paystack";
import type { ResolvedLine } from "@/backend/services/lines";
import { optionLabel } from "@/utils/labels";
import {
  availableStock,
  returnStock,
  takeStock,
} from "@/backend/services/product/stock";
import { db } from "@/server/db";
import { publicLink } from "@/server/share";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@/utils/exceptions";
import { appBaseUrl } from "@/utils/url";
import {
  Prisma,
  type Order,
  type OrderLine,
  type OrderStatus,
  type PaymentMethod,
} from "@prisma/client";

export type CheckoutInput = {
  productSlug: string;
  optionId: string;
  quantity: number;
  fulfilment: "DELIVERY" | "PICKUP";
  deliveryAddress?: string | null;
  clientName: string;
  clientPhone: string;
  clientEmail?: string | null;
};

/** The owner's list never sees an unpaid checkout. */
export type OrderListStatus = Exclude<OrderStatus, "AWAITING_PAYMENT">;

/** OPEN is the "to send out" queue: new and ready orders together. */
export type OrderListFilter = OrderListStatus | "OPEN";

export type OrderListOptions = {
  status?: OrderListFilter;
  page: number;
  size: number;
};

export type OrderStatusChange = "READY" | "COMPLETED" | "CANCELLED";

export type OrderFulfilmentInput = {
  fulfilment: "DELIVERY" | "PICKUP";
  deliveryAddress?: string | null;
};

/** The receipt facts an in-person sale needs to become an order. */
export type ReceiptSale = {
  id: string;
  businessId: string;
  customerId: string | null;
  currency: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  amountPaid: number;
  paymentMethod: PaymentMethod | null;
  lines: ResolvedLine[];
};

/** Everything a paid-for order needs that does not depend on where it came from. */
type PaidOrderInput = {
  businessId: string;
  customerId: string | null;
  source: "RECEIPT" | "INVOICE";
  status: "NEW" | "COMPLETED";
  fulfilment: "DELIVERY" | "PICKUP";
  deliveryAddress: string | null;
  currency: string;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  invoiceId?: string;
  receiptId?: string;
  lines: ResolvedLine[];
};

/** The row an order list, an order page and every update returns. */
const orderSummaryInclude = {
  lines: { orderBy: { id: "asc" } },
  customer: { select: { id: true, name: true, phone: true, email: true } },
  invoice: { select: { id: true, publicId: true, invoiceNumber: true } },
  receipt: { select: { id: true, publicId: true, receiptNumber: true } },
} satisfies Prisma.OrderInclude;

/** The extra facts changing a status or fulfilment needs, never returned. */
const orderActionInclude = {
  ...orderSummaryInclude,
  business: {
    select: { name: true, email: true, address: true, deliveryFee: true },
  },
} satisfies Prisma.OrderInclude;

export type OrderSummary = Order & {
  lines: OrderLine[];
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
  } | null;
  invoice: {
    id: string;
    publicId: string;
    invoiceNumber: string;
  } | null;
  receipt: {
    id: string;
    publicId: string;
    receiptNumber: string;
  } | null;
};

/**
 * The owner may only move an order forward. A paid order can be completed
 * directly (some orders are handed over without a separate ready step), but
 * nothing reopens once it is completed or cancelled, and an unpaid checkout is
 * never managed by hand.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatusChange[]> = {
  AWAITING_PAYMENT: [],
  NEW: ["READY", "COMPLETED", "CANCELLED"],
  READY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const STATUS_WORD: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: "awaiting payment",
  NEW: "new",
  READY: "ready",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

const STATUS_ACTION_WORD: Record<OrderStatusChange, string> = {
  READY: "ready",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

const EMAIL_KIND: Record<OrderStatusChange, "ready" | "completed" | "cancelled"> =
  {
    READY: "ready",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
  };

const UNAVAILABLE = "This product is no longer available";
const PAYMENT_SETUP =
  "This business has not set up payment processing. Please contact the service provider.";
const RETRY_CONFLICT = "Those items were just taken. Please try again.";

const NOT_OFFERED = {
  DELIVERY: "This business doesn't offer delivery",
  PICKUP: "This business doesn't offer pickup",
} as const;

/**
 * The next order number for a business: ORD-1001, then upward, following the
 * invoice-number pattern. Unpaid checkouts have no number yet, so look at the
 * newest numbered order rather than the newest order.
 */
export async function nextOrderNumber(
  client: Prisma.TransactionClient,
  businessId: string,
): Promise<string> {
  const lastOrder = await client.order.findFirst({
    where: { businessId, orderNumber: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { orderNumber: true },
  });

  let next = 1001;
  const last = lastOrder?.orderNumber;

  if (last?.startsWith("ORD-")) {
    const parsed = parseInt(last.slice("ORD-".length), 10);
    if (!Number.isNaN(parsed)) next = parsed + 1;
  }

  return `ORD-${next}`;
}

/** A slug no other order has, in the shape startCheckout uses. */
async function uniqueOrderSlug(
  client: Prisma.TransactionClient,
  businessId: string,
): Promise<string> {
  const business = await client.business.findUnique({
    where: { id: businessId },
    select: { slug: true },
  });
  const baseSlug = `${business?.slug ?? "order"}-${Date.now().toString(36)}`;
  let slug = baseSlug;
  for (let attempts = 0; attempts < 10; attempts++) {
    const existing = await client.order.findUnique({ where: { slug } });
    if (!existing) break;
    slug = `${baseSlug}-${Math.random().toString(36).substring(2, 7)}`;
  }
  return slug;
}

/**
 * Write an order for money that has already been taken: number it, take the
 * stock out and record the product lines. Must run inside the caller's
 * transaction so the order and the stock change together.
 */
async function placePaidOrder(
  client: Prisma.TransactionClient,
  input: PaidOrderInput,
): Promise<Order> {
  const productLines = input.lines.filter((line) => line.productOptionId);
  const subtotal = productLines.reduce((sum, line) => sum + line.total, 0);
  const now = new Date();

  const stock = await takeStock(
    client,
    productLines.map((line) => ({
      productOptionId: line.productOptionId!,
      quantity: line.quantity,
    })),
  );
  const orderNumber = await nextOrderNumber(client, input.businessId);
  const slug = await uniqueOrderSlug(client, input.businessId);

  return client.order.create({
    data: {
      slug,
      businessId: input.businessId,
      customerId: input.customerId,
      orderNumber,
      status: input.status,
      source: input.source,
      fulfilment: input.fulfilment,
      deliveryAddress:
        input.fulfilment === "DELIVERY" ? input.deliveryAddress : null,
      deliveryFee: 0,
      subtotal,
      total: subtotal,
      currency: input.currency,
      oversold: stock.short,
      invoiceId: input.invoiceId ?? null,
      receiptId: input.receiptId ?? null,
      clientName: input.clientName,
      clientPhone: input.clientPhone,
      clientEmail: input.clientEmail,
      paidAt: now,
      completedAt: input.status === "COMPLETED" ? now : null,
      lines: {
        create: productLines.map((line) => ({
          productOptionId: line.productOptionId,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          total: line.total,
        })),
      },
    },
  });
}

class OrderService {
  /**
   * Start an online checkout: hold the stock for 30 minutes, create the
   * AWAITING_PAYMENT order, then send the customer to Paystack. The order
   * number is left null until the payment lands.
   */
  async startCheckout(input: CheckoutInput): Promise<{
    order: Order;
    paymentUrl: string;
    paymentReference: string;
  }> {
    if (!Number.isInteger(input.quantity) || input.quantity < 1) {
      throw new BadRequestException("Enter a quantity");
    }

    const product = await db.product.findFirst({
      where: { slug: input.productSlug },
      include: {
        business: {
          select: {
            id: true,
            name: true,
            slug: true,
            currency: true,
            paystackSubaccountCode: true,
            offersDelivery: true,
            offersPickup: true,
            deliveryFee: true,
          },
        },
        options: { where: { isActive: true }, orderBy: { position: "asc" } },
      },
    });

    if (!product?.isActive) {
      throw new BadRequestException(UNAVAILABLE);
    }

    const option = product.options.find(
      (candidate) => candidate.id === input.optionId && candidate.isActive,
    );
    if (!option) {
      throw new BadRequestException(UNAVAILABLE);
    }

    const business = product.business;
    if (!business.paystackSubaccountCode) {
      throw new BadRequestException(PAYMENT_SETUP);
    }

    const offered =
      input.fulfilment === "DELIVERY"
        ? business.offersDelivery
        : business.offersPickup;
    if (!offered) {
      throw new BadRequestException(NOT_OFFERED[input.fulfilment]);
    }

    // `||`: a blank address counts as none.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const deliveryAddress = input.deliveryAddress?.trim() || null;
    if (input.fulfilment === "DELIVERY" && !deliveryAddress) {
      throw new BadRequestException("Enter a delivery address");
    }

    // Resolve before the serializable insert, so a retry cannot create a
    // second customer for the same checkout.
    const customer = await customerService.resolve(db, {
      businessId: business.id,
      name: input.clientName,
      phone: input.clientPhone,
      email: input.clientEmail,
    });

    const unitPrice = Number(option.price ?? product.price);
    const subtotal = input.quantity * unitPrice;
    const deliveryFee =
      business.offersDelivery && input.fulfilment === "DELIVERY"
        ? Number(business.deliveryFee ?? 0)
        : 0;
    const total = subtotal + deliveryFee;

    // Check availability and create the hold in one serializable transaction,
    // so two customers racing for the last item can't both get through.
    const insert = () =>
      db.$transaction(
        async (tx) => {
          const now = new Date();
          const available = await availableStock(tx, [option.id], now);
          const left = available.get(option.id);

          if (left !== null && left !== undefined && input.quantity > left) {
            throw new ConflictException(`Only ${left} left`);
          }

          const baseSlug = `${business.slug}-${Date.now().toString(36)}`;
          let slug = baseSlug;
          for (let attempts = 0; attempts < 10; attempts++) {
            const existing = await tx.order.findUnique({ where: { slug } });
            if (!existing) break;
            slug = `${baseSlug}-${Math.random().toString(36).substring(2, 7)}`;
          }

          const data: Prisma.OrderUncheckedCreateInput = {
            slug,
            businessId: business.id,
            customerId: customer?.id ?? null,
            orderNumber: null,
            status: "AWAITING_PAYMENT",
            source: "ONLINE",
            fulfilment: input.fulfilment,
            deliveryAddress:
              input.fulfilment === "DELIVERY" ? deliveryAddress : null,
            deliveryFee,
            subtotal,
            total,
            currency: business.currency,
            holdExpiresAt: holdExpiresFrom(now),
            clientName: input.clientName,
            clientPhone: input.clientPhone,
            clientEmail: input.clientEmail ?? null,
            lines: {
              create: [
                {
                  productOptionId: option.id,
                  name: optionLabel(product.name, option.name),
                  quantity: input.quantity,
                  unitPrice,
                  total: subtotal,
                },
              ],
            },
          };

          return tx.order.create({ data });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

    let order: Order;
    try {
      order = await insert();
    } catch (error) {
      if (!isSerializationFailure(error)) throw error;
      try {
        order = await insert();
      } catch (retryError) {
        if (isSerializationFailure(retryError)) {
          throw new ConflictException(RETRY_CONFLICT);
        }
        throw retryError;
      }
    }

    // `||`: Paystack needs an email, and a blank one counts as none.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const payerEmail = input.clientEmail || "customer@sara.app";
    const transaction = await paystackService.initializeTransaction({
      email: payerEmail,
      amount: Math.round(total * 100),
      subaccountCode: business.paystackSubaccountCode,
      callbackUrl: `${appBaseUrl()}/api/webhooks/paystack?o=${encodeURIComponent(order.slug)}`,
      metadata: {
        orderId: order.id,
        orderSlug: order.slug,
        businessId: business.id,
        businessName: business.name,
        productId: product.id,
        productName: product.name,
        clientName: input.clientName,
      },
      bearer: "account",
    });

    return {
      order,
      paymentUrl: transaction.authorization_url,
      paymentReference: transaction.reference,
    };
  }

  /**
   * The owner's order list, without unpaid checkouts. New and ready orders
   * queue oldest first, since they are what still needs doing; completed and
   * cancelled ones read newest first. With no status the two groups stay in
   * that order, so the list is stable from page to page.
   */
  async list(
    businessId: string,
    options: OrderListOptions,
  ): Promise<{ data: OrderSummary[]; total: number }> {
    const page = Math.max(1, options.page);
    const size = Math.max(1, options.size);
    const skip = (page - 1) * size;

    if (options.status) {
      const queue = ["NEW", "READY", "OPEN"].includes(options.status);
      const direction: Prisma.SortOrder = queue ? "asc" : "desc";
      const where: Prisma.OrderWhereInput = {
        businessId,
        status:
          options.status === "OPEN"
            ? { in: ["NEW", "READY"] }
            : options.status,
      };
      const [total, data] = await Promise.all([
        db.order.count({ where }),
        db.order.findMany({
          where,
          orderBy: [{ createdAt: direction }, { id: direction }],
          skip,
          take: size,
          include: orderSummaryInclude,
        }),
      ]);

      return { data, total };
    }

    const orders = await db.order.findMany({
      where: { businessId, status: { not: "AWAITING_PAYMENT" } },
      include: orderSummaryInclude,
    });

    // Prisma can't order by "these two statuses first, each oldest first, then
    // those two newest first", so make the one deterministic order in memory.
    const active = (status: OrderStatus) =>
      status === "NEW" || status === "READY";
    orders.sort((a, b) => {
      const aActive = active(a.status);
      const bActive = active(b.status);
      if (aActive !== bActive) return aActive ? -1 : 1;

      const byTime =
        a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
      return aActive ? byTime : -byTime;
    });

    return {
      data: orders.slice(skip, skip + size),
      total: orders.length,
    };
  }

  /** One order the business owns, with its lines, customer and documents. */
  async getBySlug(businessId: string, slug: string): Promise<OrderSummary> {
    const order = await db.order.findFirst({
      where: { slug, businessId },
      include: orderSummaryInclude,
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    return order;
  }

  /**
   * Move an order to ready, completed or cancelled. A cancellation puts the
   * stock back in the same transaction, so it can only happen once; the
   * customer hears about the change by email when they left an address.
   */
  async setStatus(
    businessId: string,
    slug: string,
    to: OrderStatusChange,
  ): Promise<OrderSummary> {
    const order = await db.order.findFirst({
      where: { slug, businessId },
      include: orderActionInclude,
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (!ALLOWED_TRANSITIONS[order.status].includes(to)) {
      throw new BadRequestException(
        `An order that is ${STATUS_WORD[order.status]} can't be marked ${STATUS_ACTION_WORD[to]}`,
      );
    }

    const now = new Date();
    const data: Prisma.OrderUpdateManyMutationInput = { status: to };
    if (to === "READY") data.readyAt = now;
    if (to === "COMPLETED") data.completedAt = now;
    if (to === "CANCELLED") data.cancelledAt = now;

    const updated = await db.$transaction(async (tx) => {
      // Only move the order from the status it was read in: two taps on
      // Cancel (or a cancel racing a complete) must not both apply, or the
      // stock would go back twice.
      const where: Prisma.OrderWhereInput = { id: order.id, status: order.status };
      const moved = await tx.order.updateMany({ where, data });
      if (moved.count === 0) {
        throw new ConflictException("This order just changed. Refresh to see where it is now.");
      }

      const result = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: orderSummaryInclude,
      });

      if (to === "CANCELLED") {
        await returnStock(
          tx,
          order.lines
            .filter((line) => line.productOptionId !== null)
            .map((line) => ({
              productOptionId: line.productOptionId!,
              quantity: line.quantity,
            })),
        );
      }

      return result;
    });

    // Best effort: the customer's address is a snapshot on the order, so an
    // email failure must never undo the status change.
    if (order.clientEmail) {
      try {
        await emailService.sendOrderEmail({
          kind: EMAIL_KIND[to],
          to: order.clientEmail,
          business: order.business,
          orderNumber: order.orderNumber ?? order.slug,
          lines: order.lines.map((line) => ({
            name: line.name,
            quantity: line.quantity,
            total: Number(line.total),
          })),
          total: Number(updated.total),
          currency: updated.currency,
          fulfilment: updated.fulfilment,
          deliveryAddress: updated.deliveryAddress,
          pickupAddress: order.business.address ?? null,
          receiptUrl: order.receipt
            ? publicLink("receipt", order.receipt.publicId)
            : null,
          orderUrl: publicLink("order", order.publicId),
        });
      } catch (error) {
        console.warn("[Orders] Status email failed:", error);
      }
    }

    return updated;
  }

  /**
   * Switch an order the owner recorded (from an invoice or a receipt) between
   * delivery and pickup, while it is still to send out. The money is already
   * in, so the fee and total never change: a delivery added after payment is
   * the owner's call to charge for separately. An online order keeps what the
   * customer chose and paid for at checkout.
   */
  async setFulfilment(
    businessId: string,
    slug: string,
    input: OrderFulfilmentInput,
  ): Promise<OrderSummary> {
    const order = await db.order.findFirst({
      where: { slug, businessId },
      select: { id: true, status: true, source: true },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (order.source === "ONLINE") {
      throw new BadRequestException(
        "An online order keeps the delivery or pickup the customer paid for",
      );
    }

    if (order.status !== "NEW" && order.status !== "READY") {
      throw new BadRequestException(
        `An order that is ${STATUS_WORD[order.status]} can't change how it is sent`,
      );
    }

    // `||`: a blank address counts as none.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const deliveryAddress = input.deliveryAddress?.trim() || null;
    if (input.fulfilment === "DELIVERY" && !deliveryAddress) {
      throw new BadRequestException("Enter a delivery address");
    }

    const data: Prisma.OrderUpdateInput = {
      fulfilment: input.fulfilment,
      deliveryAddress: input.fulfilment === "DELIVERY" ? deliveryAddress : null,
    };

    return db.order.update({
      where: { id: order.id },
      data,
      include: orderSummaryInclude,
    });
  }

  /**
   * A receipt that sold products is a sale that already happened: record it as
   * an order, take the stock and attach the payment to both. Picked up on the
   * spot it is COMPLETED straight away; a delivery starts NEW. Returns null
   * when the receipt has no product lines. Runs in the caller's transaction.
   */
  async createFromReceipt(
    client: Prisma.TransactionClient,
    receipt: ReceiptSale,
    sale: OrderFulfilmentInput,
  ): Promise<Order | null> {
    if (!receipt.lines.some((line) => line.productOptionId)) return null;

    // `||`: a blank address counts as none.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const deliveryAddress = sale.deliveryAddress?.trim() || null;
    if (sale.fulfilment === "DELIVERY" && !deliveryAddress) {
      throw new BadRequestException("Enter a delivery address");
    }

    const order = await placePaidOrder(client, {
      businessId: receipt.businessId,
      customerId: receipt.customerId,
      source: "RECEIPT",
      status: sale.fulfilment === "PICKUP" ? "COMPLETED" : "NEW",
      fulfilment: sale.fulfilment,
      deliveryAddress,
      currency: receipt.currency,
      // `||`: a blank name falls back to "Customer".
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      clientName: receipt.name?.trim() || "Customer",
      clientPhone: receipt.phone,
      clientEmail: receipt.email,
      receiptId: receipt.id,
      lines: receipt.lines,
    });

    const payment = await client.payment.create({
      data: {
        businessId: receipt.businessId,
        orderId: order.id,
        customerId: receipt.customerId,
        amount: receipt.amountPaid,
        method: receipt.paymentMethod ?? "CASH",
        clientName: receipt.name,
        clientEmail: receipt.email,
        clientPhone: receipt.phone,
      },
    });

    await client.receipt.update({
      where: { id: receipt.id },
      data: { paymentId: payment.id },
    });

    return order;
  }

  /**
   * An invoice that lists products becomes an order when its first payment
   * lands: the stock is taken then, once. Idempotent on Order.invoiceId, so a
   * later part payment (or an online payment racing the owner's) finds the
   * order that is already there and changes nothing. Invoice orders start as
   * pickup, and the owner can add delivery afterwards. Returns null when the
   * invoice has no product lines. Runs in the caller's transaction.
   */
  async createFromInvoice(
    client: Prisma.TransactionClient,
    invoiceId: string,
  ): Promise<Order | null> {
    const existing = await client.order.findUnique({ where: { invoiceId } });
    if (existing) return existing;

    const invoice = await client.invoice.findUnique({
      where: { id: invoiceId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    if (!invoice) {
      throw new NotFoundException("Invoice not found");
    }

    const lines: ResolvedLine[] = invoice.lines.map((line) => ({
      serviceId: line.serviceId,
      productOptionId: line.productOptionId,
      name: line.name,
      description: line.description,
      quantity: line.quantity,
      unitPrice: Number(line.unitPrice),
      total: Number(line.total),
      position: line.position,
    }));
    if (!lines.some((line) => line.productOptionId)) return null;

    return placePaidOrder(client, {
      businessId: invoice.businessId,
      customerId: invoice.customerId,
      source: "INVOICE",
      status: "NEW",
      fulfilment: "PICKUP",
      deliveryAddress: null,
      currency: invoice.currency,
      clientName: invoice.clientName,
      clientPhone: invoice.clientPhone,
      clientEmail: invoice.clientEmail,
      invoiceId: invoice.id,
      lines,
    });
  }
}

export const orderService = new OrderService();

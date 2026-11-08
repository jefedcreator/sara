import { Prisma } from "@prisma/client";

import { bookingMutations } from "@/backend/services/booking/mutations";
import { customerService, type UpdateCustomerInput } from "@/backend/services/customer";
import { invoiceService } from "@/backend/services/invoice";
import { finalizeInvoice } from "@/backend/services/invoice/finalize";
import { invoiceMutations } from "@/backend/services/invoice/mutations";
import type { DocumentLineInput } from "@/backend/services/lines";
import { formatMoney } from "@/backend/services/messaging/engine/amount";
import { orderService } from "@/backend/services/order";
import { productService, type ProductUpdateInput } from "@/backend/services/product";
import { requireAvailableStock, type StockLine } from "@/backend/services/product/stock";
import { receiptService } from "@/backend/services/receipt";
import { finalizeReceipt } from "@/backend/services/receipt/finalize";
import { serviceService } from "@/backend/services/service";
import { emailReceipt } from "@/backend/services/email/documents";
import { db } from "@/server/db";
import { productLink, publicLink, serviceLink } from "@/server/share";
import type { ServiceValidatorSchema, UpdateServiceValidatorSchema } from "@/backend/validators/service.validator";
import type { UpdateBookingValidatorSchema } from "@/backend/validators/booking.validator";
import type { ActionResult, ResourceKind } from "@/types/assistant";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";

import type { AssistantScope, Effect } from "../types";
import type { PreparedAction, ResolvedPayloadByKind } from "./types";

type ExecuteResult = { result: ActionResult; effects: Effect[] };
type ServiceCreateInput = Omit<ServiceValidatorSchema, "image">;
type ServiceUpdateInput = Omit<UpdateServiceValidatorSchema, "image">;

function money(minor: number): number {
  return new Prisma.Decimal(minor).div(100).toNumber();
}

function formatted(minor: number, currency: string): string {
  return formatMoney(money(minor), currency);
}

function affected(...kinds: ResourceKind[]): ResourceKind[] {
  return [...new Set(kinds)];
}

function documentLines(lines: Array<ResolvedPayloadByKind["create_invoice"]["lines"][number]>): DocumentLineInput[] {
  return lines.map((line) => ({
    serviceId: line.serviceId,
    productOptionId: line.productOptionId,
    name: line.name,
    description: line.description,
    quantity: line.quantity,
    unitPrice: money(line.unitPriceMinor),
    total: money(line.totalMinor),
  }));
}

function stockLines(lines: Array<ResolvedPayloadByKind["create_invoice"]["lines"][number]>): StockLine[] {
  return lines.flatMap((line) => line.productOptionId
    ? [{ productOptionId: line.productOptionId, quantity: line.quantity }]
    : []);
}

function dueDate(value: string | null): Date | null {
  return value ? new Date(`${value}T12:00:00.000Z`) : null;
}

/**
 * Execute one already-validated action inside the caller's transaction.
 * Every write, including customers added by a document, belongs to `tx`.
 * No HTTP, PDF, email or calendar work may happen here; those are effects.
 */
export async function executeAction(
  tx: Prisma.TransactionClient,
  scope: AssistantScope,
  prepared: PreparedAction,
  now: Date,
): Promise<ExecuteResult> {
  switch (prepared.kind) {
    case "create_invoice": {
      const p = prepared.payload as unknown as ResolvedPayloadByKind["create_invoice"];
      const invoice = await invoiceService.createInTransaction(tx, {
        businessId: scope.businessId,
        name: p.customer.name,
        email: p.customer.email,
        phone: p.customer.phone,
        customerId: p.customer.id ?? null,
        status: "SENT",
        currency: p.currency,
        subtotal: money(p.subtotalMinor),
        taxAmount: money(p.taxAmountMinor),
        discount: money(p.discountMinor),
        total: money(p.totalMinor),
        amountPaid: 0,
        dueAt: dueDate(p.dueDate),
        sentAt: now,
        notes: p.notes,
        lines: documentLines(p.lines),
      });
      const effects: Effect[] = [{ kind: "invoice_pdf", id: invoice.id }];
      if (prepared.snapshot.invoiceEmailWillBeSent === true && invoice.clientEmail) {
        effects.push({ kind: "invoice_email", id: invoice.id });
      }
      return {
        result: {
          text: `Invoice ${invoice.invoiceNumber} created for ${formatted(p.totalMinor, p.currency)}.`,
          resourceId: invoice.id,
          link: publicLink("invoice", invoice.publicId),
          affected: affected(
            "invoices",
            ...(prepared.snapshot.customerWillBeCreated === true ? ["customers" as const] : []),
            "dashboard",
          ),
        },
        effects,
      };
    }

    case "create_receipt": {
      const p = prepared.payload as unknown as ResolvedPayloadByKind["create_receipt"];
      const saleLines = stockLines(p.lines);
      if (saleLines.length > 0 && !p.fulfilment) {
        throw new BadRequestException("Choose pickup or delivery for the products");
      }
      if (saleLines.length > 0) {
        await requireAvailableStock(tx, scope.businessId, saleLines, now);
      }
      const customer = p.customer;
      const receipt = await receiptService.createInTransaction(tx, {
        businessId: scope.businessId,
        ...(customer?.id ? { customerId: customer.id } : {}),
        name: customer?.name ?? null,
        email: customer?.email ?? null,
        phone: customer?.phone ?? null,
        currency: p.currency,
        subtotal: money(p.subtotalMinor),
        taxAmount: money(p.taxAmountMinor),
        discount: money(p.discountMinor),
        total: money(p.totalMinor),
        amountPaid: money(p.amountPaidMinor),
        paymentMethod: p.method,
        notes: p.notes,
        lines: documentLines(p.lines),
        ...(saleLines.length > 0
          ? { sale: { fulfilment: p.fulfilment!, deliveryAddress: p.deliveryAddress } }
          : {}),
      });
      const effects: Effect[] = [{ kind: "receipt_pdf", id: receipt.id }];
      if (prepared.snapshot.receiptEmailWillBeSent === true && receipt.email) {
        effects.push({ kind: "receipt_email", id: receipt.id });
      }
      return {
        result: {
          text: `Receipt ${receipt.receiptNumber} created for ${formatted(p.totalMinor, p.currency)}.`,
          resourceId: receipt.id,
          link: publicLink("receipt", receipt.publicId),
          affected: affected(
            "receipts",
            ...(saleLines.length > 0 ? ["orders" as const, "products" as const] : []),
            ...(prepared.snapshot.customerWillBeCreated === true ? ["customers" as const] : []),
            "dashboard",
          ),
        },
        effects,
      };
    }

    case "record_invoice_payment": {
      const p = prepared.payload as unknown as ResolvedPayloadByKind["record_invoice_payment"];
      const invoice = await tx.invoice.findFirst({
        where: { id: p.invoiceId, businessId: scope.businessId },
        select: {
          id: true,
          publicId: true,
          invoiceNumber: true,
          amountPaid: true,
          order: { select: { id: true } },
          lines: { select: { productOptionId: true, quantity: true } },
        },
      });
      if (!invoice) throw new NotFoundException("Invoice not found");
      const firstPayment = new Prisma.Decimal(invoice.amountPaid).isZero();
      const saleLines: StockLine[] = invoice.lines.flatMap((line) => line.productOptionId
        ? [{ productOptionId: line.productOptionId, quantity: line.quantity }]
        : []);
      if (firstPayment && !invoice.order && saleLines.length > 0) {
        await requireAvailableStock(tx, scope.businessId, saleLines, now);
      }
      const mutation = await invoiceMutations.recordPaymentInTransaction(tx, scope.businessId, p.invoiceId, {
        amountMinor: p.amountMinor,
        method: p.method,
        createReceipt: p.createReceipt,
        paidAt: now,
      });
      const receipt = mutation.receiptId
        ? await tx.receipt.findFirst({
            where: { id: mutation.receiptId, businessId: scope.businessId },
            select: { receiptNumber: true, publicId: true },
          })
        : null;
      const createsOrder = firstPayment && !invoice.order && saleLines.length > 0;
      return {
        result: {
          text: `Payment of ${formatted(p.amountMinor, p.currency)} recorded on invoice ${mutation.invoice.invoiceNumber}.${
            receipt ? ` Receipt ${receipt.receiptNumber} created.` : ""
          }`,
          resourceId: mutation.invoice.id,
          link: publicLink("invoice", mutation.invoice.publicId),
          affected: affected(
            "invoices",
            ...(receipt ? ["receipts" as const] : []),
            ...(createsOrder ? ["orders" as const, "products" as const] : []),
            "dashboard",
          ),
        },
        effects: mutation.effects,
      };
    }

    case "void_invoice": {
      const p = prepared.payload as unknown as ResolvedPayloadByKind["void_invoice"];
      const invoice = await tx.invoice.findFirst({
        where: { id: p.invoiceId, businessId: scope.businessId },
        select: {
          slug: true,
          publicId: true,
          invoiceNumber: true,
          order: { select: { id: true, orderNumber: true, status: true } },
        },
      });
      if (!invoice) throw new NotFoundException("Invoice not found");
      const mutation = await invoiceMutations.updateInTransaction(tx, scope.businessId, invoice.slug, {
        status: "VOID",
        cancelOrder: p.cancelOrder,
      });
      const order = invoice.order;
      const cancelledOrder = p.cancelOrder && order !== null &&
        (order.status === "NEW" || order.status === "READY");
      return {
        result: {
          text: `Invoice ${mutation.invoice.invoiceNumber} voided.${
            cancelledOrder ? ` Order ${order.orderNumber ?? order.id} cancelled and stock returned.` : ""
          }`,
          resourceId: mutation.invoice.id,
          link: publicLink("invoice", mutation.invoice.publicId),
          affected: affected(
            "invoices",
            ...(cancelledOrder ? ["orders" as const, "products" as const] : []),
            "dashboard",
          ),
        },
        effects: mutation.effects,
      };
    }

    case "update_order": {
      const p = prepared.payload as unknown as ResolvedPayloadByKind["update_order"];
      const order = await tx.order.findFirst({
        where: { id: p.orderId, businessId: scope.businessId },
        select: { slug: true, publicId: true, orderNumber: true },
      });
      if (!order) throw new NotFoundException("Order not found");
      const mutation = await orderService.setStatusInTransaction(
        tx,
        scope.businessId,
        order.slug,
        p.status,
      );
      const status = p.status === "READY" ? "ready" : p.status === "COMPLETED" ? "completed" : "cancelled";
      return {
        result: {
          text: `Order ${mutation.order.orderNumber ?? order.orderNumber ?? mutation.order.id} marked ${status}.`,
          resourceId: mutation.order.id,
          link: publicLink("order", mutation.order.publicId),
          affected: affected(
            "orders",
            ...(p.status === "CANCELLED" ? ["products" as const] : []),
            "dashboard",
          ),
        },
        effects: mutation.effects,
      };
    }

    case "adjust_stock": {
      const p = prepared.payload as unknown as ResolvedPayloadByKind["adjust_stock"];
      const option = await tx.productOption.findFirst({
        where: { id: p.optionId, product: { businessId: scope.businessId } },
        select: { id: true, name: true, product: { select: { name: true, slug: true } } },
      });
      if (!option) throw new NotFoundException("Product option not found");
      const updated = await productService.adjustStockInTransaction(
        tx,
        scope.businessId,
        p.optionId,
        p.mode === "set" ? { set: p.quantity } : { add: p.mode === "add" ? p.quantity : -p.quantity },
      );
      const label = `${option.product.name}${option.name ? ` – ${option.name}` : ""}`;
      return {
        result: {
          text: `Stock for ${label} is now ${updated.stock}.`,
          resourceId: updated.id,
          link: productLink(option.product.slug),
          affected: affected("products", "dashboard"),
        },
        effects: [],
      };
    }

    case "update_booking": {
      const p = prepared.payload as unknown as ResolvedPayloadByKind["update_booking"];
      const booking = await tx.booking.findFirst({
        where: { id: p.bookingId, businessId: scope.businessId },
        select: {
          slug: true,
          publicId: true,
          clientName: true,
          status: true,
          service: { select: { name: true } },
        },
      });
      if (!booking) throw new NotFoundException("Booking not found");
      const patch: UpdateBookingValidatorSchema = {};
      if (p.status) patch.status = p.status;
      if (p.startTime) {
        patch.startTime = new Date(p.startTime);
        if (p.endTime) patch.endTime = new Date(p.endTime);
      }
      const mutation = await bookingMutations.updateInTransaction(
        tx,
        scope.businessId,
        booking.slug,
        patch,
      );
      const status = p.status === "CONFIRMED" ? "confirmed" : p.status === "CANCELLED" ? "cancelled" : "completed";
      return {
        result: {
          text: p.status
            ? `Booking for ${mutation.booking.clientName} marked ${status}.`
            : `Booking for ${mutation.booking.clientName} rescheduled.`,
          resourceId: mutation.booking.id,
          link: publicLink("booking", mutation.booking.publicId),
          affected: affected("bookings", "dashboard"),
        },
        effects: mutation.effects,
      };
    }

    case "create_product": {
      const p = prepared.payload as unknown as ResolvedPayloadByKind["create_product"];
      const product = await productService.createInTransaction(tx, scope.businessId, {
        name: p.name,
        description: p.description,
        price: money(p.priceMinor),
        tracksStock: p.tracksStock,
        options: p.options.map((option) => ({
          name: option.name,
          price: option.priceMinor === null ? null : money(option.priceMinor),
          stock: option.stock,
        })),
      }, []);
      return {
        result: {
          text: `Product ${product.name} created.`,
          resourceId: product.id,
          link: productLink(product.slug),
          affected: affected("products", "dashboard"),
        },
        effects: [],
      };
    }

    case "update_product": {
      const p = prepared.payload as unknown as ResolvedPayloadByKind["update_product"];
      const product = await tx.product.findFirst({
        where: { id: p.productId, businessId: scope.businessId },
        select: { slug: true, name: true },
      });
      if (!product) throw new NotFoundException("Product not found");
      const patch: ProductUpdateInput = {};
      if (p.fields.includes("name") && p.name !== null) patch.name = p.name;
      if (p.fields.includes("description")) patch.description = p.description;
      if (p.fields.includes("price") && p.priceMinor !== null) patch.price = money(p.priceMinor);
      if (p.fields.includes("isActive") && p.isActive !== null) patch.isActive = p.isActive;
      if (p.fields.includes("tracksStock") && p.tracksStock !== null) patch.tracksStock = p.tracksStock;
      if (p.fields.includes("options") && p.options !== null) {
        patch.options = p.options.map((option) => ({
          ...(option.optionId ? { id: option.optionId } : {}),
          name: option.name,
          price: option.priceMinor === null ? null : money(option.priceMinor),
          stock: option.stock,
        }));
      }
      const updated = await productService.updateInTransaction(tx, scope.businessId, product.slug, patch);
      return {
        result: {
          text: `Product ${updated.name} updated.`,
          resourceId: updated.id,
          link: productLink(updated.slug),
          affected: affected("products", "dashboard"),
        },
        effects: [],
      };
    }

    case "create_service": {
      const p = prepared.payload as unknown as ResolvedPayloadByKind["create_service"];
      const input: ServiceCreateInput = {
        name: p.name,
        description: p.description,
        price: money(p.priceMinor),
        duration: p.duration,
        bookingMode: p.bookingMode,
        availableFrom: p.availableFrom,
        availableTo: p.availableTo,
        checkInTime: p.checkInTime,
        checkOutTime: p.checkOutTime,
        minUnits: p.minUnits,
        maxUnits: p.maxUnits,
        isActive: true,
      };
      const service = await serviceService.createInTransaction(tx, scope.businessId, input, null);
      return {
        result: {
          text: `Service ${service.name} created.`,
          resourceId: service.id,
          link: serviceLink(service.slug),
          affected: affected("services", "dashboard"),
        },
        effects: [],
      };
    }

    case "update_service": {
      const p = prepared.payload as unknown as ResolvedPayloadByKind["update_service"];
      const service = await tx.service.findFirst({
        where: { id: p.serviceId, businessId: scope.businessId },
        select: { slug: true, name: true },
      });
      if (!service) throw new NotFoundException("Service not found");
      const patch: ServiceUpdateInput = {};
      if (p.fields.includes("name") && p.name !== null) patch.name = p.name;
      if (p.fields.includes("description")) patch.description = p.description;
      if (p.fields.includes("price") && p.priceMinor !== null) patch.price = money(p.priceMinor);
      if (p.fields.includes("isActive") && p.isActive !== null) patch.isActive = p.isActive;
      if (p.fields.includes("duration") && p.duration !== null) patch.duration = p.duration;
      if (p.fields.includes("bookingMode") && p.bookingMode !== null) patch.bookingMode = p.bookingMode;
      if (p.fields.includes("availableFrom") && p.availableFrom !== null) patch.availableFrom = p.availableFrom;
      if (p.fields.includes("availableTo") && p.availableTo !== null) patch.availableTo = p.availableTo;
      if (p.fields.includes("checkInTime")) patch.checkInTime = p.checkInTime;
      if (p.fields.includes("checkOutTime")) patch.checkOutTime = p.checkOutTime;
      if (p.fields.includes("minUnits") && p.minUnits !== null) patch.minUnits = p.minUnits;
      if (p.fields.includes("maxUnits") && p.maxUnits !== null) patch.maxUnits = p.maxUnits;
      const updated = await serviceService.updateInTransaction(tx, scope.businessId, service.slug, patch);
      return {
        result: {
          text: `Service ${updated.name} updated.`,
          resourceId: updated.id,
          link: serviceLink(updated.slug),
          affected: affected("services", "dashboard"),
        },
        effects: [],
      };
    }

    case "create_customer": {
      const p = prepared.payload as unknown as ResolvedPayloadByKind["create_customer"];
      const customer = await customerService.createInTransaction(tx, {
        businessId: scope.businessId,
        name: p.name,
        phone: p.phone,
        email: p.email,
        address: p.address,
        notes: p.notes,
      });
      return {
        result: {
          text: `Customer ${customer.name} created.`,
          resourceId: customer.id,
          link: null,
          affected: affected("customers", "dashboard"),
        },
        effects: [],
      };
    }

    case "update_customer": {
      const p = prepared.payload as unknown as ResolvedPayloadByKind["update_customer"];
      const patch: UpdateCustomerInput = {};
      if (p.fields.includes("name") && p.name !== null) patch.name = p.name;
      if (p.fields.includes("phone")) patch.phone = p.phone;
      if (p.fields.includes("email")) patch.email = p.email;
      if (p.fields.includes("address")) patch.address = p.address;
      if (p.fields.includes("notes")) patch.notes = p.notes;
      const customer = await customerService.updateInTransaction(tx, scope.businessId, p.customerId, patch);
      return {
        result: {
          text: `Customer ${customer.name} updated.`,
          resourceId: customer.id,
          link: null,
          affected: affected("customers", "dashboard"),
        },
        effects: [],
      };
    }

    default: {
      const exhaustive: never = prepared.kind;
      throw new BadRequestException(`Unknown action kind: ${String(exhaustive)}`);
    }
  }
}

/**
 * Best-effort delivery after the database transaction commits. Each effect is
 * isolated so one failure cannot hide the committed result or replay a write.
 */
export async function finalizeEffects(effects: Effect[]): Promise<void> {
  for (const effect of effects) {
    try {
      switch (effect.kind) {
        case "invoice_pdf":
          await finalizeInvoice(effect.id);
          break;
        case "receipt_pdf":
          await finalizeReceipt(effect.id);
          break;
        case "invoice_email":
          await invoiceMutations.finalize([effect]);
          break;
        case "receipt_email": {
          const receipt = await db.receipt.findUnique({
            where: { id: effect.id },
            include: { business: true },
          });
          if (receipt?.email) await emailReceipt(receipt, receipt.business);
          break;
        }
        case "order_email":
          await orderService.finalizeStatus(effect.id);
          break;
        case "booking_sync":
          await bookingMutations.finalize(effect);
          break;
        default: {
          const exhaustive: never = effect.kind;
          throw new Error(`Unknown effect kind: ${String(exhaustive)}`);
        }
      }
    } catch (error) {
      // Safe identifiers only: never log customer content or document bodies.
      const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "unknown";
      console.warn(`[Assistant] ${effect.kind} failed for ${effect.id} (${code})`);
    }
  }
}

export type { ExecuteResult };

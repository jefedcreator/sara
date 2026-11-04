import type { Prisma } from "@prisma/client";

import { customerService, normalizeEmail, normalizePhone, type CustomerInput } from "@/backend/services/customer";
import { activeHoldsWhere, availableStock, type StockLine } from "@/backend/services/product/stock";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";

import { lagosDay } from "../clock";
import type { AssistantScope } from "../types";
import { parseEnglishAmount, verifyOwnerPrice } from "./amount";
import type { DraftRequest, DraftLine } from "./schemas";
import type {
  Clarification,
  OwnerEvidence,
  PreparedAction,
  ResolvedPayloadByKind,
} from "./types";

const LAGOS_OFFSET = "+01:00";
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function resolveRelativeDate(text: string, now: Date): string | null {
  const lower = text.trim().toLowerCase();
  const today = lagosDay(now);
  if (lower === "today") return today;
  if (lower === "tomorrow") {
    const d = new Date(`${today}T00:00:00${LAGOS_OFFSET}`);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  const weekdayIdx = WEEKDAYS.indexOf(lower as (typeof WEEKDAYS)[number]);
  if (weekdayIdx >= 0) {
    const base = new Date(`${today}T00:00:00${LAGOS_OFFSET}`);
    const dayOfWeek = base.getDay();
    let diff = weekdayIdx - dayOfWeek;
    if (diff < 0) diff += 7;
    if (diff === 0) diff = 0; // today includes today
    base.setDate(base.getDate() + diff);
    return base.toISOString().slice(0, 10);
  }
  // Try ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
    const d = new Date(`${lower}T00:00:00${LAGOS_OFFSET}`);
    if (Number.isFinite(d.getTime())) return lower;
  }
  return null;
}

function resolvePrice(
  catalogPriceMinor: number | null,
  override: { quote: string; amountMinor: number } | null,
  evidence: OwnerEvidence,
): number {
  if (override) return verifyOwnerPrice(override, evidence);
  if (catalogPriceMinor !== null) return catalogPriceMinor;
  throw new BadRequestException("No price available; please state the price.");
}

function minorFromDecimal(d: { toNumber: () => number }): number {
  return Math.round(d.toNumber() * 100);
}

async function resolveCustomerRef(
  tx: Prisma.TransactionClient,
  businessId: string,
  ref: { kind: "existing"; id: string } | { kind: "new"; name: string; phone: string | null; email: string | null },
  evidence: OwnerEvidence,
): Promise<
  | { resolved: { id?: string; name: string; phone: string | null; email: string | null; address: string | null }; willBeCreated: boolean }
  | Clarification
> {
  if (ref.kind === "existing") {
    const customer = await tx.customer.findFirst({
      where: { id: ref.id, businessId },
      select: { id: true, name: true, phone: true, email: true, address: true },
    });
    if (!customer) throw new NotFoundException("Customer not found for this business");

    // If the id was in selectedIds, it's already disambiguated
    if (!evidence.selectedIds.includes(ref.id)) {
      // Check if the name is uniquely matching in owner text
      const nameInText = [evidence.text, ...evidence.recentOwnerTexts].some((t) =>
        t.toLowerCase().includes((customer.name ?? "").toLowerCase()),
      );
      if (!nameInText) {
        // Check if there are similar customers
        const similar = await tx.customer.findMany({
          where: { businessId, name: { contains: customer.name ?? "", mode: "insensitive" } },
          select: { id: true, name: true, phone: true, email: true },
          take: 5,
        });
        if (similar.length > 1) {
          return {
            question: `Which ${customer.name ?? "customer"} do you mean?`,
            choices: similar.map((s) => ({
              id: s.id,
              label: [s.name, s.phone, s.email].filter(Boolean).join(" · "),
            })),
            originalRequest: { kind: "create_invoice" } as DraftRequest, // placeholder, caller replaces
          };
        }
      }
    }
    return {
      resolved: {
        id: customer.id,
        name: customer.name ?? "",
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
      },
      willBeCreated: false,
    };
  }

  // New customer — search for existing match first
  const normalizedPhone = normalizePhone(ref.phone);
  const normalizedEmail = normalizeEmail(ref.email);
  const matches = await tx.customer.findMany({
    where: {
      businessId,
      OR: [
        ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
        { name: { equals: ref.name, mode: "insensitive" as const } },
      ],
    },
    select: { id: true, name: true, phone: true, email: true },
    take: 5,
  });

  if (matches.length > 0 && !evidence.selectedIds.some((id) => matches.some((m) => m.id === id))) {
    return {
      question: `A customer matching "${ref.name}" already exists. Use the existing one or create new?`,
      choices: [
        ...matches.map((m) => ({
          id: m.id,
          label: [m.name, m.phone, m.email].filter(Boolean).join(" · "),
        })),
        { id: "__new__", label: `Create new: ${ref.name}` },
      ],
      originalRequest: { kind: "create_customer" } as DraftRequest, // placeholder
    };
  }

  return {
    resolved: {
      name: ref.name,
      phone: normalizedPhone,
      email: normalizedEmail,
      address: null,
    },
    willBeCreated: true,
  };
}

async function resolveLines(
  tx: Prisma.TransactionClient,
  businessId: string,
  lines: DraftLine[],
  evidence: OwnerEvidence,
  now: Date,
): Promise<ResolvedPayloadByKind["create_invoice"]["lines"]> {
  const resolved: ResolvedPayloadByKind["create_invoice"]["lines"] = [];

  for (const line of lines) {
    if (line.kind === "custom") {
      if (!line.name) throw new BadRequestException("Custom line items require a name");
      if (!line.priceOverride) throw new BadRequestException("Custom line items require a price");
      const price = verifyOwnerPrice(line.priceOverride, evidence);
      resolved.push({
        kind: "custom",
        id: null,
        name: line.name,
        description: null,
        quantity: line.quantity,
        unitPriceMinor: price,
        totalMinor: price * line.quantity,
        serviceId: null,
        productOptionId: null,
      });
    } else if (line.kind === "service") {
      if (!line.id) throw new BadRequestException("Service line items require an id");
      const service = await tx.service.findFirst({
        where: { id: line.id, businessId, isActive: true },
        select: { id: true, name: true, price: true, description: true },
      });
      if (!service) throw new NotFoundException("Service not found or inactive");
      const catalogPrice = minorFromDecimal(service.price);
      const unitPrice = resolvePrice(catalogPrice, line.priceOverride, evidence);
      resolved.push({
        kind: "service",
        id: service.id,
        name: service.name,
        description: service.description,
        quantity: line.quantity,
        unitPriceMinor: unitPrice,
        totalMinor: unitPrice * line.quantity,
        serviceId: service.id,
        productOptionId: null,
      });
    } else if (line.kind === "product") {
      if (!line.id) throw new BadRequestException("Product line items require a product option id");
      const option = await tx.productOption.findFirst({
        where: { id: line.id, product: { businessId, isActive: true } },
        include: { product: { select: { id: true, name: true, price: true, description: true, tracksStock: true } } },
      });
      if (!option) throw new NotFoundException("Product option not found or inactive");
      const catalogPrice = option.price ? minorFromDecimal(option.price) : minorFromDecimal(option.product.price);
      const unitPrice = resolvePrice(catalogPrice, line.priceOverride, evidence);
      resolved.push({
        kind: "product",
        id: option.id,
        name: `${option.product.name}${option.name ? ` – ${option.name}` : ""}`,
        description: option.product.description,
        quantity: line.quantity,
        unitPriceMinor: unitPrice,
        totalMinor: unitPrice * line.quantity,
        serviceId: null,
        productOptionId: option.id,
      });
    }
  }
  return resolved;
}

export async function resolveDraft(
  tx: Prisma.TransactionClient,
  scope: AssistantScope,
  request: DraftRequest,
  evidence: OwnerEvidence,
  now: Date,
): Promise<PreparedAction | Clarification> {
  const { businessId } = scope;

  // Load the business currency once
  const business = await tx.business.findFirst({
    where: { id: businessId },
    select: { id: true, currency: true, name: true },
  });
  if (!business) throw new NotFoundException("Business not found");
  const currency = business.currency;

  switch (request.kind) {
    case "create_invoice": {
      const customerResult = await resolveCustomerRef(tx, businessId, request.customer, evidence);
      if ("question" in customerResult) {
        return { ...customerResult, originalRequest: request };
      }
      const { resolved: customer, willBeCreated } = customerResult;
      const lines = await resolveLines(tx, businessId, request.lines, evidence, now);
      const subtotalMinor = lines.reduce((sum, l) => sum + l.totalMinor, 0);
      const dueDate = request.dueDate ? resolveRelativeDate(request.dueDate, now) : null;

      const payload: ResolvedPayloadByKind["create_invoice"] = {
        customer: { ...customer },
        lines,
        dueDate,
        notes: request.notes,
        subtotalMinor,
        taxAmountMinor: 0,
        discountMinor: 0,
        totalMinor: subtotalMinor,
        currency,
      };
      const snapshot: Prisma.InputJsonObject = {
        businessCurrency: currency,
        businessName: business.name,
        customerWillBeCreated: willBeCreated,
        originalRequest: request as unknown as Prisma.InputJsonObject,
        resolvedAt: now.toISOString(),
      };
      return { kind: "create_invoice", payload: payload as unknown as Prisma.InputJsonObject, snapshot };
    }

    case "create_receipt": {
      if (request.lines.length > 0 && request.amount) {
        throw new BadRequestException("A receipt has either lines or an amount, not both");
      }
      if (request.lines.length === 0 && !request.amount) {
        throw new BadRequestException("A receipt needs lines or an amount");
      }

      let customer: ResolvedPayloadByKind["create_receipt"]["customer"] = null;
      let customerWillBeCreated = false;
      if (request.customer) {
        const customerResult = await resolveCustomerRef(tx, businessId, request.customer, evidence);
        if ("question" in customerResult) {
          return { ...customerResult, originalRequest: request };
        }
        customer = { ...customerResult.resolved };
        customerWillBeCreated = customerResult.willBeCreated;
      }

      let lines: ResolvedPayloadByKind["create_receipt"]["lines"] = [];
      let totalMinor: number;

      if (request.lines.length > 0) {
        lines = await resolveLines(tx, businessId, request.lines, evidence, now);
        totalMinor = lines.reduce((sum, l) => sum + l.totalMinor, 0);

        // Check if product lines need fulfilment
        const hasProducts = lines.some((l) => l.productOptionId);
        if (hasProducts && !request.fulfilment) {
          throw new BadRequestException("Product sales require a fulfilment method (PICKUP or DELIVERY)");
        }
      } else {
        totalMinor = verifyOwnerPrice(request.amount!, evidence);
      }

      const payload: ResolvedPayloadByKind["create_receipt"] = {
        customer,
        lines,
        amountPaidMinor: totalMinor,
        subtotalMinor: totalMinor,
        taxAmountMinor: 0,
        discountMinor: 0,
        totalMinor,
        method: request.method,
        fulfilment: request.fulfilment,
        deliveryAddress: request.deliveryAddress,
        notes: request.notes,
        currency,
      };
      const snapshot: Prisma.InputJsonObject = {
        businessCurrency: currency,
        customerWillBeCreated,
        originalRequest: request as unknown as Prisma.InputJsonObject,
        resolvedAt: now.toISOString(),
      };

      // Check available stock for product lines
      const stockLines: StockLine[] = lines
        .filter((l) => l.productOptionId)
        .map((l) => ({ productOptionId: l.productOptionId!, quantity: l.quantity }));
      if (stockLines.length > 0) {
        const stock = await availableStock(tx, stockLines.map((l) => l.productOptionId), now);
        const stockBefore: Record<string, number | null> = {};
        const stockAfter: Record<string, number | null> = {};
        for (const sl of stockLines) {
          const avail = stock.get(sl.productOptionId);
          stockBefore[sl.productOptionId] = avail ?? null;
          stockAfter[sl.productOptionId] = avail !== null && avail !== undefined ? avail - sl.quantity : null;
        }
        (snapshot as Record<string, unknown>).stockBefore = stockBefore;
        (snapshot as Record<string, unknown>).stockAfter = stockAfter;
      }

      return { kind: "create_receipt", payload: payload as unknown as Prisma.InputJsonObject, snapshot };
    }

    case "record_invoice_payment": {
      const invoice = await tx.invoice.findFirst({
        where: { id: request.invoiceId, businessId },
        select: {
          id: true, slug: true, status: true, total: true, amountPaid: true,
          clientName: true, currency: true, invoiceNumber: true, updatedAt: true,
        },
      });
      if (!invoice) throw new NotFoundException("Invoice not found");
      if (invoice.status === "PAID" || invoice.status === "VOID") {
        throw new BadRequestException("This invoice cannot record further payments");
      }
      const outstanding = minorFromDecimal(invoice.total) - minorFromDecimal(invoice.amountPaid);
      const amount = verifyOwnerPrice(request.amount, evidence);
      if (amount > outstanding) {
        throw new BadRequestException("Payment cannot exceed the outstanding balance");
      }

      const payload: ResolvedPayloadByKind["record_invoice_payment"] = {
        invoiceId: invoice.id,
        amountMinor: amount,
        method: request.method,
        createReceipt: request.createReceipt,
        currency: invoice.currency,
      };
      const snapshot: Prisma.InputJsonObject = {
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.clientName,
        invoiceStatus: invoice.status,
        outstandingMinor: outstanding,
        invoiceTotalMinor: minorFromDecimal(invoice.total),
        updatedAt: invoice.updatedAt.toISOString(),
        originalRequest: request as unknown as Prisma.InputJsonObject,
        resolvedAt: now.toISOString(),
      };
      return { kind: "record_invoice_payment", payload: payload as unknown as Prisma.InputJsonObject, snapshot };
    }

    case "void_invoice": {
      const invoice = await tx.invoice.findFirst({
        where: { id: request.invoiceId, businessId },
        select: {
          id: true, status: true, invoiceNumber: true, clientName: true, updatedAt: true,
        },
      });
      if (!invoice) throw new NotFoundException("Invoice not found");
      if (invoice.status === "PAID") {
        throw new BadRequestException("A paid invoice cannot be voided");
      }
      if (invoice.status === "VOID") {
        throw new BadRequestException("Invoice is already voided");
      }

      let orderInfo: Prisma.InputJsonObject | null = null;
      if (request.cancelOrder) {
        const order = await tx.order.findUnique({
          where: { invoiceId: invoice.id },
          select: { id: true, slug: true, status: true },
        });
        if (order && (order.status === "NEW" || order.status === "READY")) {
          orderInfo = { id: order.id, slug: order.slug, status: order.status };
        }
      }

      const payload: ResolvedPayloadByKind["void_invoice"] = {
        invoiceId: invoice.id,
        cancelOrder: request.cancelOrder,
      };
      const snapshot: Prisma.InputJsonObject = {
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.clientName,
        invoiceStatus: invoice.status,
        orderInfo,
        updatedAt: invoice.updatedAt.toISOString(),
        originalRequest: request as unknown as Prisma.InputJsonObject,
        resolvedAt: now.toISOString(),
      };
      return { kind: "void_invoice", payload: payload as unknown as Prisma.InputJsonObject, snapshot };
    }

    case "update_order": {
      const order = await tx.order.findFirst({
        where: { id: request.orderId, businessId },
        select: { id: true, slug: true, status: true, orderNumber: true, updatedAt: true },
      });
      if (!order) throw new NotFoundException("Order not found");

      const payload: ResolvedPayloadByKind["update_order"] = {
        orderId: order.id,
        status: request.status,
      };
      const snapshot: Prisma.InputJsonObject = {
        orderNumber: order.orderNumber,
        currentStatus: order.status,
        slug: order.slug,
        updatedAt: order.updatedAt.toISOString(),
        originalRequest: request as unknown as Prisma.InputJsonObject,
        resolvedAt: now.toISOString(),
      };
      return { kind: "update_order", payload: payload as unknown as Prisma.InputJsonObject, snapshot };
    }

    case "adjust_stock": {
      const option = await tx.productOption.findFirst({
        where: { id: request.optionId, product: { businessId } },
        include: { product: { select: { id: true, name: true, tracksStock: true } } },
      });
      if (!option) throw new NotFoundException("Product option not found");
      if (!option.product.tracksStock) {
        throw new BadRequestException("This product does not track stock");
      }

      const previous = option.stock;
      let newStock: number;
      if (request.mode === "add") newStock = previous + request.quantity;
      else if (request.mode === "remove") {
        newStock = previous - request.quantity;
        if (newStock < 0) throw new BadRequestException("Cannot remove more stock than available");
      } else {
        newStock = request.quantity;
      }

      const payload: ResolvedPayloadByKind["adjust_stock"] = {
        optionId: option.id,
        mode: request.mode,
        quantity: request.quantity,
        previousStock: previous,
        newStock,
      };
      const snapshot: Prisma.InputJsonObject = {
        productName: option.product.name,
        optionName: option.name,
        previousStock: previous,
        newStock,
        updatedAt: option.updatedAt.toISOString(),
        originalRequest: request as unknown as Prisma.InputJsonObject,
        resolvedAt: now.toISOString(),
      };
      return { kind: "adjust_stock", payload: payload as unknown as Prisma.InputJsonObject, snapshot };
    }

    case "update_booking": {
      const booking = await tx.booking.findFirst({
        where: { id: request.bookingId, businessId },
        include: {
          service: { select: { id: true, name: true, duration: true, bookingMode: true, price: true } },
        },
      });
      if (!booking) throw new NotFoundException("Booking not found");

      let startTime: string | null = null;
      let endTime: string | null = null;
      if (request.startTime) {
        const parsed = new Date(request.startTime);
        if (!Number.isFinite(parsed.getTime())) {
          throw new BadRequestException("Invalid start time");
        }
        startTime = parsed.toISOString();
        // Calculate end time from service duration
        const durationMs = booking.service.duration * 60 * 1000;
        const end = new Date(parsed.getTime() + durationMs * booking.units);
        endTime = end.toISOString();
      }

      const payload: ResolvedPayloadByKind["update_booking"] = {
        bookingId: booking.id,
        status: request.status,
        startTime,
        endTime,
        units: booking.units,
      };
      const snapshot: Prisma.InputJsonObject = {
        serviceName: booking.service.name,
        currentStatus: booking.status,
        currentStartTime: booking.startTime.toISOString(),
        currentEndTime: booking.endTime.toISOString(),
        units: booking.units,
        updatedAt: booking.updatedAt.toISOString(),
        originalRequest: request as unknown as Prisma.InputJsonObject,
        resolvedAt: now.toISOString(),
      };
      return { kind: "update_booking", payload: payload as unknown as Prisma.InputJsonObject, snapshot };
    }

    case "create_product": {
      // Check name conflict
      const existing = await tx.product.findFirst({
        where: { businessId, name: { equals: request.name, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (existing) {
        throw new BadRequestException(`A product named "${existing.name}" already exists`);
      }

      const priceMinor = verifyOwnerPrice(request.price, evidence);
      const options = request.options.map((opt) => {
        const optPrice = opt.price ? verifyOwnerPrice(opt.price, evidence) : null;
        const stock = request.tracksStock
          ? (opt.stock ?? 0)
          : 0;
        return { name: opt.name, priceMinor: optPrice, stock };
      });

      const payload: ResolvedPayloadByKind["create_product"] = {
        name: request.name,
        description: request.description,
        priceMinor,
        tracksStock: request.tracksStock,
        options,
      };
      const snapshot: Prisma.InputJsonObject = {
        originalRequest: request as unknown as Prisma.InputJsonObject,
        resolvedAt: now.toISOString(),
      };
      return { kind: "create_product", payload: payload as unknown as Prisma.InputJsonObject, snapshot };
    }

    case "update_product": {
      const product = await tx.product.findFirst({
        where: { id: request.productId, businessId },
        include: { options: { select: { id: true, name: true, price: true, stock: true } } },
      });
      if (!product) throw new NotFoundException("Product not found");

      const priceMinor = request.price ? verifyOwnerPrice(request.price, evidence) : null;
      let options: ResolvedPayloadByKind["update_product"]["options"] = null;

      if (request.options) {
        options = request.options.map((opt) => {
          if (opt.optionId) {
            const existingOpt = product.options.find((o) => o.id === opt.optionId);
            if (!existingOpt) throw new BadRequestException(`Unknown option id: ${opt.optionId}`);
          }
          const optPrice = opt.price ? verifyOwnerPrice(opt.price, evidence) : null;
          const tracksStock = request.tracksStock ?? product.tracksStock;
          const stock = tracksStock ? (opt.stock ?? 0) : 0;
          return { optionId: opt.optionId, name: opt.name, priceMinor: optPrice, stock };
        });
      }

      const payload: ResolvedPayloadByKind["update_product"] = {
        productId: product.id,
        name: request.name,
        description: request.description,
        priceMinor,
        isActive: request.isActive,
        tracksStock: request.tracksStock,
        options,
        fields: request.fields,
      };
      const snapshot: Prisma.InputJsonObject = {
        productName: product.name,
        currentPrice: minorFromDecimal(product.price),
        tracksStock: product.tracksStock,
        isActive: product.isActive,
        existingOptions: product.options.map((o) => ({
          id: o.id,
          name: o.name,
          price: o.price ? minorFromDecimal(o.price) : null,
          stock: o.stock,
        })),
        updatedAt: product.updatedAt.toISOString(),
        originalRequest: request as unknown as Prisma.InputJsonObject,
        resolvedAt: now.toISOString(),
      };
      return { kind: "update_product", payload: payload as unknown as Prisma.InputJsonObject, snapshot };
    }

    case "create_service": {
      const existing = await tx.service.findFirst({
        where: { businessId, name: { equals: request.name, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (existing) {
        throw new BadRequestException(`A service named "${existing.name}" already exists`);
      }

      const priceMinor = verifyOwnerPrice(request.price, evidence);
      const payload: ResolvedPayloadByKind["create_service"] = {
        name: request.name,
        description: request.description,
        priceMinor,
        duration: request.duration,
        bookingMode: request.bookingMode,
        availableFrom: request.availableFrom,
        availableTo: request.availableTo,
        checkInTime: request.checkInTime,
        checkOutTime: request.checkOutTime,
        minUnits: request.minUnits,
        maxUnits: request.maxUnits,
      };
      const snapshot: Prisma.InputJsonObject = {
        originalRequest: request as unknown as Prisma.InputJsonObject,
        resolvedAt: now.toISOString(),
      };
      return { kind: "create_service", payload: payload as unknown as Prisma.InputJsonObject, snapshot };
    }

    case "update_service": {
      const service = await tx.service.findFirst({
        where: { id: request.serviceId, businessId },
        select: {
          id: true, name: true, price: true, isActive: true,
          duration: true, bookingMode: true, updatedAt: true,
        },
      });
      if (!service) throw new NotFoundException("Service not found");

      const priceMinor = request.price ? verifyOwnerPrice(request.price, evidence) : null;
      const payload: ResolvedPayloadByKind["update_service"] = {
        serviceId: service.id,
        name: request.name,
        description: request.description,
        priceMinor,
        isActive: request.isActive,
        duration: request.duration,
        bookingMode: request.bookingMode,
        availableFrom: request.availableFrom,
        availableTo: request.availableTo,
        checkInTime: request.checkInTime,
        checkOutTime: request.checkOutTime,
        minUnits: request.minUnits,
        maxUnits: request.maxUnits,
        fields: request.fields,
      };
      const snapshot: Prisma.InputJsonObject = {
        serviceName: service.name,
        currentPrice: minorFromDecimal(service.price),
        isActive: service.isActive,
        duration: service.duration,
        bookingMode: service.bookingMode,
        updatedAt: service.updatedAt.toISOString(),
        originalRequest: request as unknown as Prisma.InputJsonObject,
        resolvedAt: now.toISOString(),
      };
      return { kind: "update_service", payload: payload as unknown as Prisma.InputJsonObject, snapshot };
    }

    case "create_customer": {
      const normalizedPhone = normalizePhone(request.phone);
      const normalizedEmail = normalizeEmail(request.email);

      // Search for existing match
      const matches = await tx.customer.findMany({
        where: {
          businessId,
          OR: [
            ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
            ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
            { name: { equals: request.name, mode: "insensitive" as const } },
          ],
        },
        select: { id: true, name: true, phone: true, email: true },
        take: 5,
      });

      if (matches.length > 0 && !evidence.selectedIds.some((id) => id === "__new__")) {
        return {
          question: `A customer matching "${request.name}" already exists. Use the existing one or create new?`,
          choices: [
            ...matches.map((m) => ({
              id: m.id,
              label: [m.name, m.phone, m.email].filter(Boolean).join(" · "),
            })),
            { id: "__new__", label: `Create new: ${request.name}` },
          ],
          originalRequest: request,
        };
      }

      const payload: ResolvedPayloadByKind["create_customer"] = {
        name: request.name,
        phone: normalizedPhone,
        email: normalizedEmail,
        address: request.address,
        notes: request.notes,
      };
      const snapshot: Prisma.InputJsonObject = {
        originalRequest: request as unknown as Prisma.InputJsonObject,
        resolvedAt: now.toISOString(),
      };
      return { kind: "create_customer", payload: payload as unknown as Prisma.InputJsonObject, snapshot };
    }

    case "update_customer": {
      const customer = await tx.customer.findFirst({
        where: { id: request.customerId, businessId },
        select: { id: true, name: true, phone: true, email: true, address: true, updatedAt: true },
      });
      if (!customer) throw new NotFoundException("Customer not found");

      // Validate field names
      const allowedFields = ["name", "phone", "email", "address", "notes"];
      for (const field of request.fields) {
        if (!allowedFields.includes(field)) {
          throw new BadRequestException(`Unknown customer field: ${field}`);
        }
      }

      const payload: ResolvedPayloadByKind["update_customer"] = {
        customerId: customer.id,
        name: request.fields.includes("name") ? request.name : null,
        phone: request.fields.includes("phone") ? normalizePhone(request.phone) : null,
        email: request.fields.includes("email") ? normalizeEmail(request.email) : null,
        address: request.fields.includes("address") ? request.address : null,
        notes: request.fields.includes("notes") ? request.notes : null,
        fields: request.fields,
      };
      const snapshot: Prisma.InputJsonObject = {
        customerName: customer.name,
        currentPhone: customer.phone,
        currentEmail: customer.email,
        currentAddress: customer.address,
        updatedAt: customer.updatedAt.toISOString(),
        originalRequest: request as unknown as Prisma.InputJsonObject,
        resolvedAt: now.toISOString(),
      };
      return { kind: "update_customer", payload: payload as unknown as Prisma.InputJsonObject, snapshot };
    }

    default: {
      const _exhaustive: never = request;
      throw new BadRequestException(`Unknown action kind`);
    }
  }
}

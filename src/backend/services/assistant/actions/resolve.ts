import type { Prisma } from "@prisma/client";

import { nameKey, normalizeEmail, normalizePhone } from "@/backend/services/customer/normalize";
import { activeHoldsWhere, availableStock, requireAvailableStock } from "@/backend/services/product/stock";
import { bookingTerms } from "@/backend/services/booking/terms";
import { activeBookingWhere, blockingBookingsWhere } from "@/backend/services/booking/conflicts";
import { updateCustomerValidatorSchema } from "@/backend/validators/customer.validator";
import { productValidatorSchema, updateProductValidatorSchema, stockAdjustValidatorSchema } from "@/backend/validators/product.validator";
import { serviceValidatorSchema, bookingSetupProblem } from "@/backend/validators/service.validator";
import { invoiceItemValidatorSchema } from "@/backend/validators/invoice.validator";
import { receiptSaleValidatorSchema } from "@/backend/validators/receipt.validator";
import { updateBookingValidatorSchema } from "@/backend/validators/booking.validator";
import { updateOrderValidatorSchema } from "@/backend/validators/order.validator";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";

import { lagosDay } from "../clock";
import type { AssistantScope } from "../types";
import { verifyOwnerPrice } from "./amount";
import { draftRequestSchema, type DraftRequest, type DraftLine } from "./schemas";
import type { Clarification, OwnerEvidence, PreparedAction, ResolvedPayloadByKind } from "./types";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_MS = 86_400_000;
// Prices, lines, documents and payments persist as Decimal(10,2).
const MAX_PERSISTED_MINOR = 9_999_999_999;

function resolveRelativeDate(text: string, now: Date): string {
  const lower = text.toLowerCase();
  const today = new Date(`${lagosDay(now)}T00:00:00Z`);
  if (lower === "today") return lagosDay(now);
  if (lower === "tomorrow") return new Date(today.getTime() + DAY_MS).toISOString().slice(0, 10);
  const weekday = WEEKDAYS.indexOf(lower);
  if (weekday >= 0) return new Date(today.getTime() + ((weekday - today.getUTCDay() + 7) % 7) * DAY_MS).toISOString().slice(0, 10);
  return text; // Already checked by draftRequestSchema, including calendar validity.
}

function money(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PERSISTED_MINOR) throw new BadRequestException("The calculated amount is too large");
  return value;
}

function minorFromDecimal(value: { toNumber: () => number }): number {
  return money(Math.round(value.toNumber() * 100));
}

function ownerPrice(value: { quote: string; amountMinor: number }, evidence: OwnerEvidence): number {
  return money(verifyOwnerPrice(value, evidence));
}

/** Convert known payloads and dates explicitly; never assert arbitrary data is JSON. */
function json(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(json);
  if (typeof value === "object") return jsonObject(value);
  throw new BadRequestException("Invalid snapshot value");
}

function jsonObject(value: object): Prisma.InputJsonObject {
  const result: { [key: string]: Prisma.InputJsonValue | null } = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = json(item);
  }
  return result;
}

function mentioned(texts: string[], name: string | null): boolean {
  if (!name?.trim()) return false;
  const normalized = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return texts.some((text) => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `.includes(` ${normalized} `));
}

type Candidate = { id: string; name: string | null; label: string };
function choose(request: DraftRequest, evidence: OwnerEvidence, id: string, candidates: Candidate[], question: string): Clarification | null {
  if (evidence.selectedIds.includes(id)) return null;
  const explicit = candidates.filter((candidate) => mentioned([evidence.text, ...evidence.recentOwnerTexts], candidate.name));
  if (explicit.length === 1 && explicit[0]?.id === id) return null;
  return { question, choices: candidates.slice(0, 3).map((candidate) => ({ id: candidate.id, label: candidate.label })), originalRequest: request };
}

function chooseDocument(request: DraftRequest, evidence: OwnerEvidence, id: string,
  candidates: Array<{ id: string; identifiers: string[]; label: string }>, question: string,
): Clarification | null {
  if (evidence.selectedIds.includes(id)) return null;
  const texts = [evidence.text, ...evidence.recentOwnerTexts];
  const explicit = candidates.filter((candidate) => candidate.identifiers.some((identifier) => mentioned(texts, identifier)));
  if (explicit.length === 1 && explicit[0]?.id === id) return null;
  return { question, choices: candidates.slice(0, 3).map(({ id: candidateId, label }) => ({ id: candidateId, label })), originalRequest: request };
}

async function chooseInvoice(tx: Prisma.TransactionClient, businessId: string, request: DraftRequest, evidence: OwnerEvidence, id: string): Promise<Clarification | null> {
  const candidates = await tx.invoice.findMany({
    where: { businessId },
    select: { id: true, invoiceNumber: true, slug: true, publicId: true, clientName: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  return chooseDocument(request, evidence, id, candidates.map((row) => ({
    id: row.id, identifiers: [row.invoiceNumber, row.slug, row.publicId, row.id],
    label: `${row.invoiceNumber} · ${row.clientName} · ${row.status}`,
  })), "Which invoice do you mean? Please select one or state its invoice number.");
}

const customerSelect = { id: true, name: true, phone: true, email: true, address: true, updatedAt: true } as const;
function customerLabel(customer: { name: string | null; phone: string | null; email: string | null }): string {
  return [customer.name, customer.phone, customer.email].filter(Boolean).join(" · ");
}

async function resolveCustomerRef(tx: Prisma.TransactionClient, businessId: string,
  ref: { kind: "existing"; id: string } | { kind: "new"; name: string; phone: string | null; email: string | null },
  evidence: OwnerEvidence, request: DraftRequest,
): Promise<{ resolved: ResolvedPayloadByKind["create_invoice"]["customer"]; willBeCreated: boolean; updatedAt: string | null } | Clarification> {
  if (ref.kind === "existing") {
    const customer = await tx.customer.findFirst({ where: { id: ref.id, businessId }, select: customerSelect });
    if (!customer) throw new NotFoundException("Customer not found for this business");
    const candidates = await tx.customer.findMany({
      where: { businessId, name: { contains: customer.name?.trim().split(/\s+/)[0] ?? "", mode: "insensitive" } }, select: customerSelect,
    });
    const clarification = choose(request, evidence, customer.id, candidates.map((row) => ({ ...row, label: customerLabel(row) })), "Which customer do you mean?");
    if (clarification) return clarification;
    return { resolved: { id: customer.id, name: customer.name ?? "", phone: customer.phone, email: customer.email, address: customer.address }, willBeCreated: false, updatedAt: customer.updatedAt.toISOString() };
  }
  const normalized = updateCustomerValidatorSchema.parse({ name: ref.name, phone: ref.phone, email: ref.email });
  const phone = normalizePhone(normalized.phone);
  const email = normalizeEmail(normalized.email);
  if (ref.phone?.trim() && !phone) throw new BadRequestException("Please provide a valid customer phone number");
  const matches = await tx.customer.findMany({ where: { businessId, OR: [
    ...(phone ? [{ phone }] : []), ...(email ? [{ email }] : []),
    { nameKey: nameKey(ref.name) },
    { name: { contains: ref.name.trim(), mode: "insensitive" } },
  ] }, select: customerSelect });
  const selected = matches.find((row) => evidence.selectedIds.includes(row.id));
  if (selected) return { resolved: { id: selected.id, name: selected.name ?? "", phone: selected.phone, email: selected.email, address: selected.address }, willBeCreated: false, updatedAt: selected.updatedAt.toISOString() };
  if (matches.length) return {
    question: "A matching customer already exists. Which customer should I use?",
    choices: matches.slice(0, 3).map((row) => ({ id: row.id, label: customerLabel(row) })), originalRequest: request,
  };
  return { resolved: { name: normalized.name ?? ref.name.trim(), phone, email, address: null }, willBeCreated: true, updatedAt: null };
}

type CatalogLine = { unitPriceMinor: number; isActive: boolean; productIsActive: boolean | null; tracksStock: boolean | null; id: string | null; kind: DraftLine["kind"]; updatedAt: string | null; productUpdatedAt: string | null; optionName: string | null; optionPriceMinor: number | null; physicalStock: number | null; catalogPriceMinor: number | null; priceSource: "owner" | "catalog"; ownerQuote: string | null; availableStock: number | null };
async function resolveLines(tx: Prisma.TransactionClient, businessId: string, lines: DraftLine[], evidence: OwnerEvidence, now: Date, request: DraftRequest): Promise<{
  lines: ResolvedPayloadByKind["create_invoice"]["lines"]; catalogLines: CatalogLine[]; stockBefore: Record<string, number | null>; stockAfter: Record<string, number | null>;
} | Clarification> {
  const resolved: ResolvedPayloadByKind["create_invoice"]["lines"] = [];
  const catalogLines: CatalogLine[] = [];
  for (const line of lines) {
    let name: string;
    let description: string | null = null;
    let catalogPrice: number | null = null;
    let updatedAt: string | null = null;
    let productUpdatedAt: string | null = null;
    let tracksStock: boolean | null = null;
    let optionName: string | null = null;
    let optionPriceMinor: number | null = null;
    let physicalStock: number | null = null;
    if (line.kind === "custom") {
      if (!line.name || !line.priceOverride || line.id !== null) throw new BadRequestException("Custom lines need a name and price, with no catalog id");
      name = line.name.trim();
    } else if (line.kind === "service") {
      if (!line.id) throw new BadRequestException("Service lines need an owned id");
      const service = await tx.service.findFirst({ where: { id: line.id, businessId, isActive: true } });
      if (!service) throw new NotFoundException("Service not found or inactive");
      const candidates = await tx.service.findMany({ where: { businessId, isActive: true, name: { contains: service.name.trim().split(/\s+/)[0] ?? service.name, mode: "insensitive" } }, select: { id: true, name: true } });
      const clarification = choose(request, evidence, service.id, candidates.map((row) => ({ ...row, label: row.name })), "Which service do you mean?");
      if (clarification) return clarification;
      name = service.name; description = service.description;
      catalogPrice = minorFromDecimal(service.price); updatedAt = service.updatedAt.toISOString();
    } else {
      if (!line.id) throw new BadRequestException("Product lines need an owned option id");
      const option = await tx.productOption.findFirst({ where: { id: line.id, isActive: true, product: { businessId, isActive: true } }, include: { product: true } });
      if (!option) throw new NotFoundException("Product option not found or inactive");
      const candidates = await tx.productOption.findMany({ where: { isActive: true, product: { businessId, isActive: true, name: { contains: option.product.name.trim().split(/\s+/)[0] ?? option.product.name, mode: "insensitive" } } }, include: { product: true } });
      const clarification = choose(request, evidence, option.id, candidates.map((row) => ({ id: row.id, name: `${row.product.name} ${row.name}`.trim(), label: `${row.product.name}${row.name ? ` – ${row.name}` : ""}` })), "Which product option do you mean?");
      if (clarification) return clarification;
      name = `${option.product.name}${option.name ? ` – ${option.name}` : ""}`;
      description = option.product.description;
      catalogPrice = minorFromDecimal(option.price ?? option.product.price);
      // ProductOption has no timestamp; freeze its actual material fields instead.
      productUpdatedAt = option.product.updatedAt.toISOString(); tracksStock = option.product.tracksStock;
      optionName = option.name; optionPriceMinor = option.price === null ? null : minorFromDecimal(option.price); physicalStock = option.stock;
    }
    const unitPriceMinor = line.priceOverride ? ownerPrice(line.priceOverride, evidence) : catalogPrice;
    if (unitPriceMinor === null) throw new BadRequestException("Please state the price");
    const totalMinor = money(unitPriceMinor * line.quantity);
    // Existing shared line validator remains the second boundary layer.
    invoiceItemValidatorSchema.parse({ name, description: description || null, quantity: line.quantity, unitPrice: unitPriceMinor / 100, total: totalMinor / 100 });
    const previous = resolved.find((row) => line.id !== null && row.kind === line.kind && row.id === line.id && row.unitPriceMinor === unitPriceMinor);
    if (previous) { previous.quantity += line.quantity; previous.totalMinor = money(previous.totalMinor + totalMinor); }
    else resolved.push({ kind: line.kind, id: line.id, name, description, quantity: line.quantity, unitPriceMinor, totalMinor, serviceId: line.kind === "service" ? line.id : null, productOptionId: line.kind === "product" ? line.id : null });
    catalogLines.push({ unitPriceMinor, isActive: true, productIsActive: line.kind === "product" ? true : null, tracksStock, id: line.id, kind: line.kind, updatedAt, productUpdatedAt, optionName, optionPriceMinor, physicalStock, catalogPriceMinor: catalogPrice, priceSource: line.priceOverride ? "owner" : "catalog", ownerQuote: line.priceOverride?.quote ?? null, availableStock: null });
  }
  const quantities = new Map<string, number>();
  for (const row of resolved) if (row.productOptionId) quantities.set(row.productOptionId, (quantities.get(row.productOptionId) ?? 0) + row.quantity);
  const available = await availableStock(tx, [...quantities.keys()], now);
  const stockBefore: Record<string, number | null> = {};
  const stockAfter: Record<string, number | null> = {};
  for (const [id, quantity] of quantities) {
    if (!available.has(id)) throw new NotFoundException("Product option stock not found");
    const count = available.get(id) ?? null;
    if (request.kind === "create_receipt" && count !== null && count < quantity) throw new BadRequestException("Not enough stock available for this sale");
    stockBefore[id] = count;
    stockAfter[id] = request.kind === "create_receipt" && count !== null ? count - quantity : count;
    for (const row of catalogLines) if (row.id === id && row.kind === "product") row.availableStock = count;
  }
  return { lines: resolved, catalogLines, stockBefore, stockAfter };
}

function validateOptions(options: Array<{ name: string; optionId?: string | null }>): void {
  if (options.length > 1 && options.some((option) => !option.name.trim())) throw new BadRequestException("Name each product option");
  const names = options.map((option) => option.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) throw new BadRequestException("Each option needs a different name");
  const ids = options.flatMap((option) => option.optionId ? [option.optionId] : []);
  if (new Set(ids).size !== ids.length) throw new BadRequestException("An option cannot occur twice");
}

async function stockChange(tx: Prisma.TransactionClient, businessId: string, lines: Array<{ productOptionId: string | null; name: string; quantity: number }>, now: Date, direction: 1 | -1) {
  const restockLines = lines.flatMap((line) => line.productOptionId ? [{ ...line, productOptionId: line.productOptionId }] : []);
  const ids = [...new Set(restockLines.map((line) => line.productOptionId))];
  const options = ids.length ? await tx.productOption.findMany({ where: { id: { in: ids }, product: { businessId } }, include: { product: true } }) : [];
  for (const id of ids) if (!options.some((row) => row.id === id)) throw new NotFoundException("Product option not found for this business");
  const held = ids.length ? await tx.orderLine.groupBy({
    by: ["productOptionId"],
    where: { productOptionId: { in: ids }, order: { businessId, ...activeHoldsWhere(now) } },
    _sum: { quantity: true },
  }) : [];
  const heldByOption = new Map(held.map((row) => [row.productOptionId, row._sum.quantity ?? 0]));
  const quantities = new Map<string, number>();
  for (const line of restockLines) quantities.set(line.productOptionId, (quantities.get(line.productOptionId) ?? 0) + line.quantity);
  const stockRows = options.map((row) => {
    const heldQuantity = heldByOption.get(row.id) ?? 0;
    const physicalStockAfter = row.product.tracksStock ? Math.max(0, row.stock + direction * (quantities.get(row.id) ?? 0)) : row.stock;
    if (physicalStockAfter > 2_147_483_647) throw new BadRequestException("The resulting stock is too large");
    return { id: row.id, name: row.name, priceMinor: row.price === null ? null : minorFromDecimal(row.price), productUpdatedAt: row.product.updatedAt.toISOString(), stock: row.stock, physicalStockAfter, heldQuantity, tracksStock: row.product.tracksStock, isActive: row.isActive, productIsActive: row.product.isActive };
  });
  const stockBefore: Record<string, number | null> = {};
  const stockAfter: Record<string, number | null> = {};
  for (const row of stockRows) {
    stockBefore[row.id] = row.tracksStock ? Math.max(row.stock - row.heldQuantity, 0) : null;
    stockAfter[row.id] = row.tracksStock ? Math.max(row.physicalStockAfter - row.heldQuantity, 0) : null;
  }
  return { restockLines, stockBefore, stockAfter, stockRows };
}

export async function resolveDraft(
  tx: Prisma.TransactionClient,
  scope: AssistantScope,
  request: DraftRequest,
  evidence: OwnerEvidence,
  now: Date,
): Promise<PreparedAction | Clarification> {
  request = draftRequestSchema.parse(request);
  const { businessId } = scope;

  // Load the business currency once
  const business = await tx.business.findFirst({
    where: { id: businessId },
    select: { id: true, currency: true, name: true },
  });
  if (!business) throw new NotFoundException("Business not found");
  const currency = business.currency;
  const baseSnapshot = { businessId, businessCurrency: currency, businessName: business.name,
    originalRequest: jsonObject(request), ownerEvidence: jsonObject({ text: evidence.text, recentOwnerTexts: [...evidence.recentOwnerTexts], selectedIds: [...evidence.selectedIds] }),
    resolvedAt: now.toISOString() } satisfies Prisma.InputJsonObject;

  switch (request.kind) {
    case "create_invoice": {
      const customerResult = await resolveCustomerRef(tx, businessId, request.customer, evidence, request);
      if ("question" in customerResult) {
        return { ...customerResult, originalRequest: request };
      }
      const { resolved: customer, willBeCreated } = customerResult;
      const lineResult = await resolveLines(tx, businessId, request.lines, evidence, now, request);
      if ("question" in lineResult) return lineResult;
      const { lines } = lineResult;
      const subtotalMinor = money(lines.reduce((sum, l) => sum + l.totalMinor, 0));
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
        customerWillBeCreated: willBeCreated,
        customerUpdatedAt: customerResult.updatedAt,
        clientEmail: customer.email, createsOrder: false, invoiceEmailWillBeSent: false,
        resolvedRequest: jsonObject({ ...request, dueDate }),
        catalogLines: json(lineResult.catalogLines), stockBefore: jsonObject(lineResult.stockBefore), stockAfter: jsonObject(lineResult.stockAfter),
        ...baseSnapshot,
      };
      return { kind: "create_invoice", payload: jsonObject(payload), snapshot };
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
      let customerUpdatedAt: string | null = null;
      if (request.customer) {
        const customerResult = await resolveCustomerRef(tx, businessId, request.customer, evidence, request);
        if ("question" in customerResult) {
          return { ...customerResult, originalRequest: request };
        }
        customer = { ...customerResult.resolved };
        customerWillBeCreated = customerResult.willBeCreated;
        customerUpdatedAt = customerResult.updatedAt;
      }

      let lines: ResolvedPayloadByKind["create_receipt"]["lines"] = [];
      let totalMinor: number;
      let lineSnapshot: Prisma.InputJsonObject = { catalogLines: [], stockBefore: {}, stockAfter: {} };

      if (request.lines.length > 0) {
        const lineResult = await resolveLines(tx, businessId, request.lines, evidence, now, request);
        if ("question" in lineResult) return lineResult;
        lines = lineResult.lines;
        lineSnapshot = { catalogLines: json(lineResult.catalogLines), stockBefore: jsonObject(lineResult.stockBefore), stockAfter: jsonObject(lineResult.stockAfter) };
        totalMinor = money(lines.reduce((sum, l) => sum + l.totalMinor, 0));

        // Check if product lines need fulfilment
        const hasProducts = lines.some((l) => l.productOptionId);
        if (hasProducts && !request.fulfilment) {
          return { question: "How will the customer receive the products: pickup or delivery?", choices: [], originalRequest: request };
        }
      } else {
        if (!request.amount) throw new BadRequestException("Please state the receipt amount");
        totalMinor = ownerPrice(request.amount, evidence);
      }

      if (lines.some((row) => row.productOptionId !== null) && request.fulfilment) {
        receiptSaleValidatorSchema.parse({ fulfilment: request.fulfilment, deliveryAddress: request.deliveryAddress });
        if (request.fulfilment === "DELIVERY" && !request.deliveryAddress?.trim()) return { question: "What is the delivery address?", choices: [], originalRequest: request };
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
        deliveryAddress: request.fulfilment === "DELIVERY" ? request.deliveryAddress?.trim() ?? null : null,
        notes: request.notes,
        currency,
      };
      const snapshot: Prisma.InputJsonObject = {
        customerWillBeCreated,
        customerUpdatedAt, clientEmail: customer?.email ?? null,
        createsOrder: lines.some((row) => row.productOptionId !== null),
        orderStatus: lines.some((row) => row.productOptionId !== null) ? (request.fulfilment === "PICKUP" ? "COMPLETED" : "NEW") : null,
        deliveryFeeMinor: 0, receiptEmailWillBeSent: false, ...lineSnapshot,
        ...baseSnapshot,
      };

      return { kind: "create_receipt", payload: jsonObject(payload), snapshot };
    }

    case "record_invoice_payment": {
      const invoice = await tx.invoice.findFirst({
        where: { id: request.invoiceId, businessId },
        select: {
          id: true, slug: true, status: true, total: true, amountPaid: true,
          clientName: true, clientPhone: true, clientEmail: true, currency: true, invoiceNumber: true, updatedAt: true,
          lines: { select: { name: true, productOptionId: true, quantity: true } },
          order: { select: { id: true } },
        },
      });
      if (!invoice) throw new NotFoundException("Invoice not found");
      const clarification = await chooseInvoice(tx, businessId, request, evidence, invoice.id);
      if (clarification) return clarification;
      if (invoice.status === "PAID" || invoice.status === "VOID") {
        throw new BadRequestException("This invoice cannot record further payments");
      }
      const outstanding = minorFromDecimal(invoice.total) - minorFromDecimal(invoice.amountPaid);
      const amount = ownerPrice(request.amount, evidence);
      if (amount > outstanding) {
        throw new BadRequestException("Payment cannot exceed the outstanding balance");
      }

      const createsOrder = minorFromDecimal(invoice.amountPaid) === 0 && !invoice.order && invoice.lines.some((line) => line.productOptionId !== null);
      if (createsOrder) await requireAvailableStock(tx, businessId, invoice.lines.flatMap((line) => line.productOptionId ? [{ productOptionId: line.productOptionId, quantity: line.quantity }] : []), now);
      const saleStock = await stockChange(tx, businessId, createsOrder ? invoice.lines : [], now, -1);
      const payload: ResolvedPayloadByKind["record_invoice_payment"] = {
        invoiceId: invoice.id,
        amountMinor: amount,
        method: request.method,
        createReceipt: request.createReceipt,
        currency: invoice.currency,
      };
      const snapshot: Prisma.InputJsonObject = {
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.clientName, clientPhone: invoice.clientPhone,
        invoiceStatus: invoice.status,
        clientEmail: invoice.clientEmail, createsOrder, productLines: json(saleStock.restockLines),
        stockRows: json(saleStock.stockRows), stockBefore: jsonObject(saleStock.stockBefore), stockAfter: jsonObject(saleStock.stockAfter),
        invoiceEmailWillBeSent: false, receiptEmailWillBeSent: false,
        outstandingMinor: outstanding,
        invoiceTotalMinor: minorFromDecimal(invoice.total),
        updatedAt: invoice.updatedAt.toISOString(),
        ...baseSnapshot,
      };
      return { kind: "record_invoice_payment", payload: jsonObject(payload), snapshot };
    }

    case "void_invoice": {
      const invoice = await tx.invoice.findFirst({
        where: { id: request.invoiceId, businessId },
        select: {
          id: true, status: true, invoiceNumber: true, clientName: true, clientPhone: true, clientEmail: true, updatedAt: true,
        },
      });
      if (!invoice) throw new NotFoundException("Invoice not found");
      const clarification = await chooseInvoice(tx, businessId, request, evidence, invoice.id);
      if (clarification) return clarification;
      if (invoice.status === "PAID") {
        throw new BadRequestException("A paid invoice cannot be voided");
      }
      if (invoice.status === "VOID") {
        throw new BadRequestException("Invoice is already voided");
      }

      let orderInfo: Prisma.InputJsonObject | null = null;
      if (request.cancelOrder) {
        const order = await tx.order.findFirst({
          where: { invoiceId: invoice.id, businessId },
          select: { id: true, slug: true, status: true, clientEmail: true, updatedAt: true, lines: { select: { name: true, productOptionId: true, quantity: true } } },
        });
        if (order && (order.status === "NEW" || order.status === "READY")) {
          orderInfo = jsonObject({ id: order.id, slug: order.slug, status: order.status, clientEmail: order.clientEmail, updatedAt: order.updatedAt, ...await stockChange(tx, businessId, order.lines, now, 1) });
        }
      }

      const payload: ResolvedPayloadByKind["void_invoice"] = {
        invoiceId: invoice.id,
        cancelOrder: request.cancelOrder,
      };
      const snapshot: Prisma.InputJsonObject = {
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.clientName, clientPhone: invoice.clientPhone,
        invoiceStatus: invoice.status,
        orderInfo, clientEmail: invoice.clientEmail, invoiceEmailWillBeSent: false,
        updatedAt: invoice.updatedAt.toISOString(),
        ...baseSnapshot,
      };
      return { kind: "void_invoice", payload: jsonObject(payload), snapshot };
    }

    case "update_order": {
      const order = await tx.order.findFirst({
        where: { id: request.orderId, businessId },
        select: { id: true, slug: true, status: true, orderNumber: true, updatedAt: true, clientName: true, clientPhone: true, clientEmail: true, lines: { select: { name: true, productOptionId: true, quantity: true } } },
      });
      if (!order) throw new NotFoundException("Order not found");

      const candidates = await tx.order.findMany({ where: { businessId }, select: { id: true, orderNumber: true, slug: true, publicId: true, clientName: true, status: true }, orderBy: { createdAt: "desc" } });
      const clarification = chooseDocument(request, evidence, order.id, candidates.map((row) => ({ id: row.id, identifiers: [row.orderNumber, row.slug, row.publicId, row.id], label: `${row.orderNumber} · ${row.clientName} · ${row.status}` })), "Which order do you mean? Please select one or state its order number.");
      if (clarification) return clarification;

      updateOrderValidatorSchema.parse({ status: request.status });
      if ((order.status !== "NEW" && order.status !== "READY") || (order.status === "READY" && request.status === "READY")) throw new BadRequestException("This order cannot move to that status");
      const restock = await stockChange(tx, businessId, request.status === "CANCELLED" ? order.lines : [], now, 1);
      const payload: ResolvedPayloadByKind["update_order"] = {
        orderId: order.id,
        status: request.status,
      };
      const snapshot: Prisma.InputJsonObject = {
        orderNumber: order.orderNumber,
        clientName: order.clientName, clientPhone: order.clientPhone, clientEmail: order.clientEmail, ...jsonObject(restock),
        currentStatus: order.status,
        slug: order.slug,
        updatedAt: order.updatedAt.toISOString(),
        ...baseSnapshot,
      };
      return { kind: "update_order", payload: jsonObject(payload), snapshot };
    }

    case "adjust_stock": {
      const option = await tx.productOption.findFirst({
        where: { id: request.optionId, product: { businessId } },
        include: { product: { select: { id: true, name: true, tracksStock: true, updatedAt: true } } },
      });
      if (!option) throw new NotFoundException("Product option not found");
      if (!option.product.tracksStock) {
        throw new BadRequestException("This product does not track stock");
      }

      stockAdjustValidatorSchema.parse({ optionId: request.optionId, ...(request.mode === "set" ? { set: request.quantity } : { add: request.mode === "remove" ? -request.quantity : request.quantity }) });
      const candidates = await tx.productOption.findMany({ where: { product: { businessId, name: { contains: option.product.name.trim().split(/\s+/)[0] ?? option.product.name, mode: "insensitive" } } }, include: { product: true } });
      const clarification = choose(request, evidence, option.id, candidates.map((row) => ({ id: row.id, name: `${row.product.name} ${row.name}`.trim(), label: `${row.product.name} – ${row.name}` })), "Which product option should I adjust?");
      if (clarification) return clarification;
      const previous = option.stock;
      let newStock: number;
      if (request.mode === "add") newStock = previous + request.quantity;
      else if (request.mode === "remove") {
        newStock = previous - request.quantity;
        if (newStock < 0) throw new BadRequestException("Cannot remove more stock than available");
      } else {
        newStock = request.quantity;
      }

      if (!Number.isSafeInteger(newStock) || newStock > 2_147_483_647) throw new BadRequestException("The resulting stock is too large");
      const payload: ResolvedPayloadByKind["adjust_stock"] = {
        optionId: option.id,
        mode: request.mode,
        quantity: request.quantity,
        previousStock: previous,
        newStock,
      };
      const snapshot: Prisma.InputJsonObject = {
        productName: option.product.name,
        optionName: option.name, productUpdatedAt: option.product.updatedAt.toISOString(), tracksStock: option.product.tracksStock,
        previousStock: previous,
        newStock,
        ...baseSnapshot,
      };
      return { kind: "adjust_stock", payload: jsonObject(payload), snapshot };
    }

    case "update_booking": {
      const booking = await tx.booking.findFirst({
        where: { id: request.bookingId, businessId },
        include: {
          service: true,
        },
      });
      if (!booking || booking.service.businessId !== businessId) throw new NotFoundException("Booking not found");
      const candidates = await tx.booking.findMany({ where: { businessId }, select: { id: true, slug: true, publicId: true, clientName: true, startTime: true, service: { select: { name: true } } }, orderBy: { startTime: "desc" } });
      const clarification = chooseDocument(request, evidence, booking.id, candidates.map((row) => ({ id: row.id, identifiers: [row.slug, row.publicId, row.id], label: `${row.clientName} · ${row.service.name} · ${row.startTime.toISOString()} · ${row.slug}` })), "Which booking do you mean? Please select one or state its booking reference.");
      if (clarification) return clarification;
      const transitions: Record<string, string[]> = { PENDING: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["COMPLETED", "CANCELLED"], COMPLETED: [], CANCELLED: [] };
      if (request.status && !transitions[booking.status]?.includes(request.status)) throw new BadRequestException("This booking cannot move to that status");
      updateBookingValidatorSchema.parse({ ...(request.status ? { status: request.status } : {}), ...(request.startTime ? { startTime: request.startTime } : {}) });

      let startTime: string | null = null;
      let endTime: string | null = null;
      if (request.startTime) {
        const parsed = new Date(request.startTime);
        if (!Number.isFinite(parsed.getTime())) {
          throw new BadRequestException("Invalid start time");
        }
        startTime = parsed.toISOString();
        const nextStatus = request.status ?? booking.status;
        if (nextStatus !== "PENDING" && nextStatus !== "CONFIRMED") throw new BadRequestException("This booking cannot be rescheduled");
        const terms = bookingTerms(booking.service, parsed, booking.units, { now, enforceUnitLimits: false });
        endTime = terms.endTime.toISOString();
        const overlap = await tx.booking.findFirst({ where: blockingBookingsWhere(booking.service, { start: parsed, end: terms.endTime }, { now, excludeId: booking.id }), select: { id: true } });
        if (overlap) throw new BadRequestException("Those dates or that time are already booked");
      }

      const payload: ResolvedPayloadByKind["update_booking"] = {
        bookingId: booking.id,
        status: request.status,
        startTime,
        endTime,
        units: booking.units,
      };
      const snapshot: Prisma.InputJsonObject = {
        serviceName: booking.service.name, clientName: booking.clientName, clientPhone: booking.clientPhone, bookingSlug: booking.slug, clientEmail: booking.clientEmail,
        calendarEventExists: Boolean(booking.googleEventId),
        calendarSyncNeeded: Boolean(booking.googleEventId) && (request.status === "CANCELLED" || (startTime !== null && (startTime !== booking.startTime.toISOString() || endTime !== booking.endTime.toISOString()))),
        emailWillBeSent: Boolean(booking.clientEmail) && (request.status === "CANCELLED" || (startTime !== null && (startTime !== booking.startTime.toISOString() || endTime !== booking.endTime.toISOString()))),
        serviceUpdatedAt: booking.service.updatedAt.toISOString(), bookingMode: booking.service.bookingMode,
        bookingTerms: jsonObject({ duration: booking.service.duration, checkInTime: booking.service.checkInTime, checkOutTime: booking.service.checkOutTime, minUnits: booking.service.minUnits, maxUnits: booking.service.maxUnits }),
        currentStatus: booking.status,
        currentStartTime: booking.startTime.toISOString(),
        currentEndTime: booking.endTime.toISOString(),
        units: booking.units,
        updatedAt: booking.updatedAt.toISOString(),
        ...baseSnapshot,
      };
      return { kind: "update_booking", payload: jsonObject(payload), snapshot };
    }

    case "create_product": {
      // Check name conflict
      const existing = await tx.product.findFirst({
        where: { businessId, name: { equals: request.name.trim(), mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (existing) return { question: `A product named "${existing.name}" already exists. Should I update it, or use a different name?`, choices: [{ id: existing.id, label: existing.name }], originalRequest: request };

      const priceMinor = ownerPrice(request.price, evidence);
      const options = request.options.map((opt) => {
        const optPrice = opt.price ? ownerPrice(opt.price, evidence) : null;
        if (request.tracksStock && opt.stock === null) throw new BadRequestException("State the stock for every tracked option");
        const stock = request.tracksStock ? opt.stock ?? 0 : 0;
        return { name: opt.name.trim(), priceMinor: optPrice, stock };
      });

      validateOptions(options);
      productValidatorSchema.parse({ name: request.name.trim(), description: request.description?.trim() || null, price: priceMinor / 100, tracksStock: request.tracksStock, options: options.map((option) => ({ name: option.name, price: option.priceMinor === null ? null : option.priceMinor / 100, stock: option.stock })) });
      const payload: ResolvedPayloadByKind["create_product"] = {
        name: request.name.trim(),
        description: request.description?.trim() || null,
        priceMinor,
        tracksStock: request.tracksStock,
        options,
      };
      const snapshot: Prisma.InputJsonObject = {
        ...baseSnapshot,
      };
      return { kind: "create_product", payload: jsonObject(payload), snapshot };
    }

    case "update_product": {
      const product = await tx.product.findFirst({
        where: { id: request.productId, businessId },
        include: { options: true },
      });
      if (!product) throw new NotFoundException("Product not found");

      const candidates = await tx.product.findMany({ where: { businessId, name: { contains: product.name.trim().split(/\s+/)[0] ?? product.name, mode: "insensitive" } }, select: { id: true, name: true } });
      const clarification = choose(request, evidence, product.id, candidates.map((row) => ({ ...row, label: row.name })), "Which product should I update?");
      if (clarification) return clarification;
      const priceMinor = request.price ? ownerPrice(request.price, evidence) : null;
      let options: ResolvedPayloadByKind["update_product"]["options"] = null;

      if (request.options) {
        options = request.options.map((opt) => {
          if (opt.optionId) {
            const existingOpt = product.options.find((o) => o.id === opt.optionId);
            if (!existingOpt) throw new BadRequestException(`Unknown option id: ${opt.optionId}`);
          }
          const optPrice = opt.price ? ownerPrice(opt.price, evidence) : null;
          const tracksStock = request.tracksStock ?? product.tracksStock;
          const previous = product.options.find((row) => row.id === opt.optionId);
          if (tracksStock && opt.stock === null && !previous) throw new BadRequestException("State the stock for every new tracked option");
          const stock = tracksStock ? opt.stock ?? previous?.stock ?? 0 : 0;
          return { optionId: opt.optionId, name: opt.name.trim(), priceMinor: optPrice, stock };
        });
      }

      if (options) validateOptions(options);
      updateProductValidatorSchema.parse({
        ...(request.fields.includes("name") ? { name: request.name } : {}),
        ...(request.fields.includes("description") ? { description: request.description } : {}),
        ...(priceMinor !== null ? { price: priceMinor / 100 } : {}),
        ...(request.isActive !== null ? { isActive: request.isActive } : {}),
        ...(request.tracksStock !== null ? { tracksStock: request.tracksStock } : {}),
        ...(options ? { options: options.map((option) => ({ ...(option.optionId ? { id: option.optionId } : {}), name: option.name, price: option.priceMinor === null ? null : option.priceMinor / 100, stock: option.stock })) } : {}),
      });
      const payload: ResolvedPayloadByKind["update_product"] = {
        productId: product.id,
        name: request.name?.trim() ?? null,
        description: request.description?.trim() || null,
        priceMinor,
        isActive: request.isActive,
        tracksStock: request.tracksStock,
        options,
        fields: request.fields,
      };
      const snapshot: Prisma.InputJsonObject = {
        productName: product.name, currentDescription: product.description,
        currentPrice: minorFromDecimal(product.price),
        tracksStock: product.tracksStock,
        isActive: product.isActive,
        existingOptions: product.options.map((o) => ({
          id: o.id,
          name: o.name,
          price: o.price ? minorFromDecimal(o.price) : null,
          stock: o.stock, isActive: o.isActive,
        })),
        updatedAt: product.updatedAt.toISOString(),
        ...baseSnapshot,
      };
      return { kind: "update_product", payload: jsonObject(payload), snapshot };
    }

    case "create_service": {
      const existing = await tx.service.findFirst({
        where: { businessId, name: { equals: request.name.trim(), mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (existing) return { question: `A service named "${existing.name}" already exists. Should I update it, or use a different name?`, choices: [{ id: existing.id, label: existing.name }], originalRequest: request };

      const priceMinor = ownerPrice(request.price, evidence);
      const setup = serviceValidatorSchema.parse({ ...request, name: request.name.trim(), price: priceMinor / 100 });
      const problem = bookingSetupProblem(setup);
      if (problem) throw new BadRequestException(problem);
      const payload: ResolvedPayloadByKind["create_service"] = {
        name: request.name.trim(),
        description: request.description?.trim() || null,
        priceMinor,
        duration: request.duration,
        bookingMode: request.bookingMode,
        availableFrom: request.availableFrom,
        availableTo: request.availableTo,
        checkInTime: request.bookingMode === "NIGHTLY" ? request.checkInTime : null,
        checkOutTime: request.bookingMode === "NIGHTLY" ? request.checkOutTime : null,
        minUnits: request.minUnits,
        maxUnits: request.maxUnits,
      };
      const snapshot: Prisma.InputJsonObject = {
        ...baseSnapshot,
      };
      return { kind: "create_service", payload: jsonObject(payload), snapshot };
    }

    case "update_service": {
      const service = await tx.service.findFirst({
        where: { id: request.serviceId, businessId },
      });
      if (!service) throw new NotFoundException("Service not found");

      const priceMinor = request.price ? ownerPrice(request.price, evidence) : null;
      const candidates = await tx.service.findMany({ where: { businessId, name: { contains: service.name.trim().split(/\s+/)[0] ?? service.name, mode: "insensitive" } }, select: { id: true, name: true } });
      const clarification = choose(request, evidence, service.id, candidates.map((row) => ({ ...row, label: row.name })), "Which service should I update?");
      if (clarification) return clarification;
      const patch: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(request)) if (request.fields.includes(field)) patch[field] = field === "price" ? (priceMinor === null ? null : priceMinor / 100) : value;
      const merged = serviceValidatorSchema.parse({ ...service, image: undefined, price: minorFromDecimal(service.price) / 100, ...patch });
      const problem = bookingSetupProblem(merged);
      if (problem) throw new BadRequestException(problem);
      if (merged.bookingMode !== service.bookingMode) {
        const upcoming = await tx.booking.count({ where: { businessId, serviceId: service.id, endTime: { gt: now }, AND: [activeBookingWhere(now)] } });
        if (upcoming > 0) throw new BadRequestException("Finish or cancel the upcoming bookings first");
      }
      if (request.name !== null) {
        const conflict = await tx.service.findFirst({ where: { businessId, id: { not: service.id }, name: { equals: request.name.trim(), mode: "insensitive" } }, select: { id: true } });
        if (conflict) throw new BadRequestException("A service with that name already exists");
      }
      if (merged.bookingMode !== "NIGHTLY" && ((request.fields.includes("checkInTime") && request.checkInTime !== null) || (request.fields.includes("checkOutTime") && request.checkOutTime !== null))) throw new BadRequestException("Check-in and check-out times apply only to nightly bookings");
      const payload: ResolvedPayloadByKind["update_service"] = {
        serviceId: service.id,
        name: request.name?.trim() ?? null,
        description: request.description?.trim() || null,
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
        serviceName: service.name, currentService: jsonObject({ name: service.name, description: service.description, priceMinor: minorFromDecimal(service.price), isActive: service.isActive, duration: service.duration, bookingMode: service.bookingMode, availableFrom: service.availableFrom, availableTo: service.availableTo, checkInTime: service.checkInTime, checkOutTime: service.checkOutTime, minUnits: service.minUnits, maxUnits: service.maxUnits }),
        currentPrice: minorFromDecimal(service.price),
        isActive: service.isActive,
        duration: service.duration,
        bookingMode: service.bookingMode,
        updatedAt: service.updatedAt.toISOString(),
        ...baseSnapshot,
      };
      return { kind: "update_service", payload: jsonObject(payload), snapshot };
    }

    case "create_customer": {
      const normalized = updateCustomerValidatorSchema.parse({ name: request.name, phone: request.phone, email: request.email, address: request.address, notes: request.notes });
      const normalizedPhone = normalizePhone(normalized.phone);
      const normalizedEmail = normalizeEmail(normalized.email);
      if (request.phone?.trim() && !normalizedPhone) throw new BadRequestException("Please provide a valid customer phone number");

      // Search for existing match
      const matches = await tx.customer.findMany({
        where: {
          businessId,
          OR: [
            ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
            ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
            { nameKey: nameKey(request.name) },
            { name: { contains: request.name.trim(), mode: "insensitive" as const } },
          ],
        },
        select: { id: true, name: true, phone: true, email: true },
      });

      if (matches.length > 0) {
        return {
          question: `A customer matching "${request.name}" already exists. Should I update an existing customer, or use a different name?`,
          choices: [
            ...matches.slice(0, 3).map((m) => ({
              id: m.id,
              label: [m.name, m.phone, m.email].filter(Boolean).join(" · "),
            })),
          ],
          originalRequest: request,
        };
      }

      const payload: ResolvedPayloadByKind["create_customer"] = {
        name: request.name.trim(),
        phone: normalizedPhone,
        email: normalizedEmail,
        address: request.address?.trim() || null,
        notes: request.notes?.trim() || null,
      };
      const snapshot: Prisma.InputJsonObject = {
        ...baseSnapshot,
      };
      return { kind: "create_customer", payload: jsonObject(payload), snapshot };
    }

    case "update_customer": {
      const customer = await tx.customer.findFirst({
        where: { id: request.customerId, businessId },
        select: { id: true, name: true, phone: true, email: true, address: true, notes: true, updatedAt: true },
      });
      if (!customer) throw new NotFoundException("Customer not found");

      const chosen = await resolveCustomerRef(tx, businessId, { kind: "existing", id: customer.id }, evidence, request);
      if ("question" in chosen) return chosen;
      const patch: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(request)) if (request.fields.includes(field)) patch[field] = value;
      const normalized = updateCustomerValidatorSchema.parse(patch);
      if (normalized.phone?.trim() && !normalizePhone(normalized.phone)) throw new BadRequestException("Please provide a valid customer phone number");
      const phone = normalizePhone(normalized.phone);
      const email = normalizeEmail(normalized.email);
      if (phone || email) {
        const conflict = await tx.customer.findFirst({ where: { businessId, id: { not: customer.id }, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] }, select: { id: true } });
        if (conflict) throw new BadRequestException("Another customer already has that phone or email");
      }
      const payload: ResolvedPayloadByKind["update_customer"] = {
        customerId: customer.id,
        name: request.fields.includes("name") ? normalized.name ?? null : null,
        phone: request.fields.includes("phone") ? phone : null,
        email: request.fields.includes("email") ? email : null,
        address: request.fields.includes("address") ? normalized.address?.trim() || null : null,
        notes: request.fields.includes("notes") ? normalized.notes?.trim() || null : null,
        fields: request.fields,
      };
      const snapshot: Prisma.InputJsonObject = {
        customerName: customer.name,
        currentPhone: customer.phone,
        currentEmail: customer.email,
        currentAddress: customer.address, currentNotes: customer.notes,
        updatedAt: customer.updatedAt.toISOString(),
        ...baseSnapshot,
      };
      return { kind: "update_customer", payload: jsonObject(payload), snapshot };
    }

    default: {
      return assertNever(request);
    }
  }
}

function assertNever(_request: never): never {
  throw new BadRequestException("Unknown action kind");
}

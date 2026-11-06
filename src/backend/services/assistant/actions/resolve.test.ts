import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const objectContaining = (value: unknown): unknown => expect.objectContaining(value);
const arrayContaining = (value: unknown[]): unknown => expect.arrayContaining(value);
const stringContaining = (value: string): unknown => expect.stringContaining(value);

const mocks = vi.hoisted(() => {
  const delegate = () => ({ findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() });
  return { business: delegate(), customer: delegate(), invoice: delegate(), receipt: delegate(), order: delegate(), booking: delegate(), service: delegate(), product: delegate(), productOption: delegate(), orderLine: { groupBy: vi.fn() } };
});
vi.mock("@/server/db", () => ({ db: mocks }));
import { db } from "@/server/db";
import { resolveDraft } from "./resolve";
import { draftRequestSchema, type DraftRequest } from "./schemas";
import type { OwnerEvidence } from "./types";
import type { AssistantScope } from "../types";

const NOW = new Date("2026-11-04T10:00:00Z");
const scope: AssistantScope = { businessId: "biz_1", channel: "WEB", principalId: "owner_1" };
const customer = { id: "cus_1", name: "Tolu Adekunle", phone: "+2348035550142", email: "tolu@example.com", address: "Lagos", updatedAt: NOW };
const otherCustomer = { ...customer, id: "cus_2", name: "Tolu Bakare", phone: "+2348035550143" };
const service = { id: "svc_1", businessId: "biz_1", name: "Wig installation", description: "Install", price: new Prisma.Decimal(5000), isActive: true, duration: 60, bookingMode: "SLOT", availableFrom: "08:00", availableTo: "17:00", checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 30, updatedAt: NOW, image: "https://example.com/service.jpg" };
const product = { id: "prod_1", businessId: "biz_1", name: "Frontal wig", description: null, price: new Prisma.Decimal(45000), tracksStock: true, isActive: true, updatedAt: NOW };
// ProductOption has no updatedAt column. Fixtures must match persisted rows.
const option = { id: "opt_1", productId: product.id, name: "Black", price: null, stock: 10, isActive: true, product };
const otherOption = { ...option, id: "opt_2", name: "Brown" };
const invoice = { id: "inv_1", slug: "inv-1", publicId: "invoice-public-1", status: "SENT", total: new Prisma.Decimal(90000), amountPaid: new Prisma.Decimal(0), clientName: customer.name, clientPhone: customer.phone, clientEmail: customer.email, currency: "NGN", invoiceNumber: "INV-1001", updatedAt: NOW, lines: [], order: null };
const order = { id: "ord_1", slug: "ord-1", publicId: "order-public-1", status: "NEW", orderNumber: "ORD-1001", fulfilment: "PICKUP", deliveryAddress: null, currency: "NGN", total: new Prisma.Decimal(90000), updatedAt: NOW, clientName: customer.name, clientPhone: customer.phone, clientEmail: customer.email, lines: [{ name: "Frontal wig – Black", productOptionId: "opt_1", quantity: 2 }] };
const booking = { id: "book_1", slug: "booking-1", publicId: "booking-public-1", status: "CONFIRMED", clientName: customer.name, clientPhone: customer.phone, clientEmail: customer.email, googleEventId: "event_1", startTime: new Date("2026-11-06T14:00:00Z"), endTime: new Date("2026-11-06T15:00:00Z"), units: 1, updatedAt: NOW, service };
const evidence: OwnerEvidence = { text: "Invoice Tolu for a wig at 45,000 and installation at 5,000", recentOwnerTexts: [], selectedIds: ["cus_1", "opt_1", "svc_1", "prod_1", "inv_1", "ord_1", "book_1"] };
const invoiceRequest: DraftRequest = { kind: "create_invoice", customer: { kind: "existing", id: "cus_1" }, lines: [{ kind: "product", id: "opt_1", name: null, quantity: 2, priceOverride: null }], dueDate: null, notes: null };
const receiptRequest: DraftRequest = { kind: "create_receipt", customer: null, lines: invoiceRequest.lines, amount: null, method: "CASH", fulfilment: "PICKUP", deliveryAddress: null, notes: null };
const productPatch: DraftRequest = { kind: "update_product", productId: "prod_1", name: null, description: null, price: null, isActive: false, tracksStock: null, options: null, fields: ["isActive"] };
const servicePatch: DraftRequest = { kind: "update_service", serviceId: "svc_1", name: null, description: null, price: null, isActive: null, duration: 90, bookingMode: null, availableFrom: null, availableTo: null, checkInTime: null, checkOutTime: null, minUnits: null, maxUnits: null, fields: ["duration"] };
const customerPatch: DraftRequest = { kind: "update_customer", customerId: "cus_1", name: null, phone: null, email: null, address: null, notes: null, fields: ["phone"] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.business.findFirst.mockResolvedValue({ id: "biz_1", currency: "NGN", name: "Salon" });
  mocks.customer.findFirst.mockResolvedValue(customer);
  mocks.customer.findMany.mockResolvedValue([customer, otherCustomer]);
  mocks.service.findFirst.mockResolvedValue(service);
  mocks.service.findMany.mockResolvedValue([service]);
  mocks.product.findFirst.mockResolvedValue({ ...product, options: [option, otherOption] });
  mocks.product.findMany.mockResolvedValue([product]);
  mocks.productOption.findFirst.mockResolvedValue(option);
  mocks.productOption.findMany.mockResolvedValue([option, otherOption]);
  mocks.orderLine.groupBy.mockResolvedValue([]);
  mocks.invoice.findFirst.mockResolvedValue(invoice);
  mocks.invoice.findMany.mockResolvedValue([invoice]);
  mocks.order.findFirst.mockResolvedValue(order);
  mocks.order.findMany.mockResolvedValue([order]);
  mocks.booking.findFirst.mockResolvedValue(booking);
  mocks.booking.findMany.mockResolvedValue([booking]);
  mocks.booking.count.mockResolvedValue(0);
});

async function prepared(request: DraftRequest, ownerEvidence = evidence, now = NOW) {
  const result = await resolveDraft(db, scope, request, ownerEvidence, now);
  if ("question" in result) throw new Error(`Unexpected clarification: ${result.question}`);
  return result;
}

function expectNoWrites() {
  for (const model of [mocks.customer, mocks.invoice, mocks.receipt, mocks.product, mocks.service, mocks.order, mocks.booking, mocks.productOption]) {
    expect(model.create).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
    expect(model.updateMany).not.toHaveBeenCalled();
  }
}

describe("strict boundary and money", () => {
  it("rejects injected business scope, forged customer ids and missing method", async () => {
    expect(() => draftRequestSchema.parse({ ...invoiceRequest, businessId: "foreign" })).toThrow();
    expect(() => draftRequestSchema.parse({ ...receiptRequest, method: null })).toThrow();
    mocks.customer.findFirst.mockResolvedValue(null);
    await expect(prepared(invoiceRequest)).rejects.toThrow("Customer not found");
    expect(mocks.customer.findFirst).toHaveBeenCalledWith(objectContaining({ where: { id: "cus_1", businessId: "biz_1" } }));
    expectNoWrites();
  });

  it("uses catalog fallback, aggregates duplicate options and freezes trusted evidence", async () => {
    const request = { ...invoiceRequest, lines: [...invoiceRequest.lines, ...invoiceRequest.lines] };
    const result = await prepared(request);
    expect(result.payload.totalMinor).toBe(18_000_000);
    expect(result.payload.lines).toEqual([objectContaining({ quantity: 4, unitPriceMinor: 4_500_000, totalMinor: 18_000_000 })]);
    expect(result.snapshot.originalRequest).toEqual(request);
    expect(result.snapshot.ownerEvidence).toEqual(evidence);
    expect(result.snapshot.catalogLines).toEqual([objectContaining({ catalogPriceMinor: 4_500_000, priceSource: "catalog", updatedAt: null, productUpdatedAt: NOW.toISOString(), optionName: "Black", optionPriceMinor: null, physicalStock: 10, availableStock: 10 }), expect.anything()]);
    evidence.selectedIds.push("later");
    expect(result.snapshot.ownerEvidence).not.toEqual(evidence);
    evidence.selectedIds.pop();
    expectNoWrites();
  });

  it("uses the option price before product price and verifies overrides", async () => {
    mocks.productOption.findFirst.mockResolvedValue({ ...option, price: new Prisma.Decimal(47000) });
    expect((await prepared(invoiceRequest)).payload.totalMinor).toBe(9_400_000);
    const overridden: DraftRequest = { ...invoiceRequest, lines: [{ ...invoiceRequest.lines[0]!, priceOverride: { quote: "5,000", amountMinor: 500_000 } }] };
    expect((await prepared(overridden)).payload.totalMinor).toBe(1_000_000);
    await expect(prepared(overridden, { ...evidence, text: "Use catalog prices" })).rejects.toThrow("price");
  });

  it.each(["bottles", "packs"])("does not let quantity-only %s evidence replace the catalog price", async (noun) => {
    const trusted = { text: `Invoice Tolu for two ${noun} shea butter`, recentOwnerTexts: [], selectedIds: [customer.id, option.id] };
    const override: DraftRequest = { ...invoiceRequest, lines: [{ ...invoiceRequest.lines[0]!, priceOverride: { quote: "two", amountMinor: 200 } }] };
    await expect(prepared(override, trusted)).rejects.toThrow("Please state the price");
    const catalogDraft = await prepared(invoiceRequest, trusted);
    expect(catalogDraft.payload.lines).toEqual([objectContaining({ quantity: 2, unitPriceMinor: 4_500_000, totalMinor: 9_000_000 })]);
    expectNoWrites();
  });

  it.each([
    ["1234", "Invoice Tolu for two bottles, product code 1234"],
    ["1234", "Invoice number 1234"],
    ["#1234", "Invoice #1234"],
    ["#1234", "Product reference #1234"],
  ])("does not use reference %s as a catalog price override", async (quote, text) => {
    const trusted = { text, recentOwnerTexts: [], selectedIds: [customer.id, option.id] };
    const override: DraftRequest = { ...invoiceRequest, lines: [{ ...invoiceRequest.lines[0]!, priceOverride: { quote, amountMinor: 123_400 } }] };
    await expect(prepared(override, trusted)).rejects.toThrow("Please state the price");
    expect((await prepared(invoiceRequest, trusted)).payload.totalMinor).toBe(9_000_000);
    expectNoWrites();
  });

  it("resolves Lagos relative dates independently of host timezone", async () => {
    expect((await prepared({ ...invoiceRequest, dueDate: "tomorrow" })).payload.dueDate).toBe("2026-11-05");
    expect((await prepared({ ...invoiceRequest, dueDate: "friday" })).payload.dueDate).toBe("2026-11-06");
    expect((await prepared({ ...invoiceRequest, dueDate: "friday" }, evidence, new Date("2026-11-05T23:30:00Z"))).payload.dueDate).toBe("2026-11-06");
    expect(() => draftRequestSchema.parse({ ...invoiceRequest, dueDate: "2026-02-30" })).toThrow();
  });
});

describe("trusted selection", () => {
  it("returns two labelled Tolu choices even if the model supplies a valid owned id", async () => {
    const result = await resolveDraft(db, scope, invoiceRequest, { text: "Invoice Tolu for a wig", recentOwnerTexts: [], selectedIds: [] }, NOW);
    expect(result).toEqual({ question: (expect.any(String) as unknown), choices: [{ id: "cus_1", label: stringContaining("Tolu Adekunle") }, { id: "cus_2", label: stringContaining("Tolu Bakare") }], originalRequest: invoiceRequest });
    expect(mocks.productOption.findFirst).not.toHaveBeenCalled();
  });

  it("allows a unique explicit full name; duplicate full names still require selection", async () => {
    const trusted = { ...evidence, text: "Invoice Tolu Adekunle for a wig", selectedIds: ["opt_1"] };
    expect((await prepared(invoiceRequest, trusted)).kind).toBe("create_invoice");
    mocks.customer.findMany.mockResolvedValue([customer, { ...otherCustomer, name: customer.name }]);
    expect(await resolveDraft(db, scope, invoiceRequest, trusted, NOW)).toHaveProperty("question");
  });

  it("does not let a model choose one of two wig options from a generic product name", async () => {
    const result = await resolveDraft(db, scope, invoiceRequest, { ...evidence, text: "Invoice Tolu for a frontal wig", selectedIds: ["cus_1"] }, NOW);
    expect(result).toHaveProperty("choices", [{ id: "opt_1", label: "Frontal wig – Black" }, { id: "opt_2", label: "Frontal wig – Brown" }]);
    expect((await prepared(invoiceRequest, { ...evidence, text: "Invoice Tolu for Frontal wig Black", selectedIds: ["cus_1"] })).kind).toBe("create_invoice");
  });

  it("accepts explicit option names before a plural product name without a recorded choice", async () => {
    mocks.productOption.findFirst.mockResolvedValue({ ...option, name: "18-inch" });
    mocks.productOption.findMany.mockResolvedValue([{ ...option, name: "18-inch" }, { ...otherOption, name: "20-inch" }]);
    const trusted = { text: "Invoice Tolu Adekunle for two 18-inch frontal wigs", recentOwnerTexts: [], selectedIds: [] };
    expect((await prepared(invoiceRequest, trusted)).payload.lines).toEqual([objectContaining({ productOptionId: option.id, quantity: 2 })]);
    expect(await resolveDraft(db, scope, invoiceRequest, { ...trusted, text: "Invoice Tolu Adekunle for two frontal wigs" }, NOW)).toHaveProperty("question");
    expectNoWrites();
  });

  it("resolves a unique natural booking description and freezes the accepted selection", async () => {
    const pending = { ...booking, status: "PENDING", startTime: new Date("2026-11-05T09:00:00Z"), endTime: new Date("2026-11-05T10:00:00Z") };
    mocks.booking.findFirst.mockResolvedValueOnce(pending).mockResolvedValueOnce(null);
    mocks.booking.findMany.mockResolvedValue([pending, booking]);
    const trusted = { text: "Confirm Tolu Adekunle's pending booking tomorrow", recentOwnerTexts: [], selectedIds: [] };
    const result = await prepared({ kind: "update_booking", bookingId: pending.id, status: "CONFIRMED", startTime: null }, trusted);
    expect(result.snapshot.ownerEvidence).toMatchObject({ selectedIds: [pending.id] });
    expectNoWrites();
  });

  it("asks when two owned bookings match a natural customer/date description", async () => {
    const tomorrow = { ...booking, startTime: new Date("2026-11-05T09:00:00Z") };
    mocks.booking.findFirst.mockResolvedValue(tomorrow);
    mocks.booking.findMany.mockResolvedValue([tomorrow, { ...tomorrow, id: "book_2" }]);
    expect(await resolveDraft(db, scope, { kind: "update_booking", bookingId: tomorrow.id, status: "CANCELLED", startTime: null }, {
      text: "Cancel Tolu Adekunle's booking tomorrow", recentOwnerTexts: [], selectedIds: [],
    }, NOW)).toMatchObject({ choices: [{ id: tomorrow.id }, { id: "book_2" }] });
    expectNoWrites();
  });

  it("does not confuse a requested completed status with the existing booking selector", async () => {
    const tomorrow = { ...booking, startTime: new Date("2026-11-05T09:00:00Z") };
    mocks.booking.findFirst.mockResolvedValue(tomorrow);
    mocks.booking.findMany.mockResolvedValue([tomorrow]);
    expect((await prepared({ kind: "update_booking", bookingId: tomorrow.id, status: "COMPLETED", startTime: null }, {
      text: "Mark Tolu Adekunle's booking tomorrow completed", recentOwnerTexts: [], selectedIds: [],
    })).payload.status).toBe("COMPLETED");
  });

  it("asks before a duplicate new customer or product and never writes", async () => {
    const request: DraftRequest = { kind: "create_customer", name: "Tolu Adekunle", phone: null, email: null, address: null, notes: null };
    expect(await resolveDraft(db, scope, request, evidence, NOW)).toHaveProperty("question");
    const productRequest: DraftRequest = { kind: "create_product", name: product.name, description: null, price: { quote: "45,000", amountMinor: 4_500_000 }, tracksStock: true, options: [{ name: "Black", price: null, stock: 10 }] };
    expect(await resolveDraft(db, scope, productRequest, evidence, NOW)).toHaveProperty("question");
    expectNoWrites();
  });

  it("requires a recorded stock choice when two owned products share the full option label", async () => {
    const duplicate = { ...option, id: "opt_duplicate", productId: "prod_duplicate", product: { ...product, id: "prod_duplicate" } };
    mocks.productOption.findMany.mockResolvedValue([option, duplicate]);
    const request: DraftRequest = { kind: "adjust_stock", optionId: option.id, mode: "add", quantity: 2 };
    const trusted = { text: "Add two to Frontal wig Black stock", recentOwnerTexts: [], selectedIds: [] };
    expect(await resolveDraft(db, scope, request, trusted, NOW)).toHaveProperty("choices", [
      { id: option.id, label: "Frontal wig – Black" }, { id: duplicate.id, label: "Frontal wig – Black" },
    ]);
    expect(mocks.productOption.findMany).toHaveBeenCalledWith(objectContaining({ where: {
      product: { businessId: scope.businessId, name: { contains: "Frontal", mode: "insensitive" } },
    } }));
    expect((await prepared(request, { ...trusted, selectedIds: [option.id] })).payload.newStock).toBe(12);
    expectNoWrites();
  });

  it("uses normalized name keys for duplicate customer creation and new invoice references", async () => {
    const create: DraftRequest = { kind: "create_customer", name: "Tolu  Adekunle", phone: null, email: null, address: null, notes: null };
    const invoiceWithNewCustomer: DraftRequest = { ...invoiceRequest, customer: { kind: "new", name: create.name, phone: null, email: null } };
    for (const request of [create, invoiceWithNewCustomer]) {
      expect(await resolveDraft(db, scope, request, { ...evidence, selectedIds: [] }, NOW)).toHaveProperty("question");
      expect(mocks.customer.findMany).toHaveBeenLastCalledWith(objectContaining({
        where: objectContaining({ businessId: scope.businessId, OR: arrayContaining([{ nameKey: "tolu adekunle" }]) }),
      }));
    }
    expectNoWrites();
  });
});

describe("trusted document selection", () => {
  const payment: DraftRequest = { kind: "record_invoice_payment", invoiceId: invoice.id, amount: { quote: "45,000", amountMinor: 4_500_000 }, method: "CASH", createReceipt: false };
  const requests: DraftRequest[] = [payment,
    { kind: "void_invoice", invoiceId: invoice.id, cancelOrder: false },
    { kind: "update_order", orderId: order.id, status: "READY" },
    { kind: "update_booking", bookingId: booking.id, status: "CANCELLED", startTime: null },
  ];

  it("does not accept arbitrary owned invoice, order or booking IDs from generic owner text", async () => {
    mocks.invoice.findMany.mockResolvedValue([invoice, { ...invoice, id: "inv_2", invoiceNumber: "INV-1002", slug: "inv-2", publicId: "invoice-public-2" }]);
    mocks.order.findMany.mockResolvedValue([order, { ...order, id: "ord_2", orderNumber: "ORD-1002", slug: "ord-2", publicId: "order-public-2" }]);
    mocks.booking.findMany.mockResolvedValue([booking, { ...booking, id: "book_2", slug: "booking-2", publicId: "booking-public-2" }]);
    for (const request of requests) {
      const result = await resolveDraft(db, scope, request, { text: "Cancel Tolu's document or record 45,000", recentOwnerTexts: [], selectedIds: [] }, NOW);
      expect(result).toMatchObject({ question: (expect.any(String) as unknown), choices: [objectContaining({ label: stringContaining(customer.name) }), expect.anything()], originalRequest: request });
    }
    for (const delegate of [mocks.invoice, mocks.order, mocks.booking]) {
      expect(delegate.findMany).toHaveBeenCalledWith(objectContaining({ where: { businessId: scope.businessId } }));
    }
    expectNoWrites();
  });

  it("accepts a unique explicit document number or booking reference in trusted text", async () => {
    const references = [invoice.invoiceNumber, invoice.invoiceNumber, order.orderNumber, booking.publicId];
    for (const [index, request] of requests.entries()) {
      const text = request.kind === "record_invoice_payment" ? `Record payment 45,000 on ${references[index]}` : `Update ${references[index]}`;
      const result = await prepared(request, { text, recentOwnerTexts: [], selectedIds: [] });
      expect(result.kind).toBe(request.kind);
    }
    expectNoWrites();
  });

  it("rejects an explicit reference to a different owned invoice and accepts a stored selection", async () => {
    mocks.invoice.findMany.mockResolvedValue([invoice, { ...invoice, id: "inv_2", invoiceNumber: "INV-1002", slug: "inv-2", publicId: "invoice-public-2" }]);
    expect(await resolveDraft(db, scope, payment, { text: "Record 45,000 on INV-1002", recentOwnerTexts: [], selectedIds: [] }, NOW)).toHaveProperty("question");
    expect((await prepared(payment, { text: "Record 45,000", recentOwnerTexts: [], selectedIds: [invoice.id] })).kind).toBe(payment.kind);
  });
});

describe("sales and stock", () => {
  it("freezes persisted option facts and the parent version without inventing option timestamps", async () => {
    const patched = await prepared(productPatch);
    expect(patched.snapshot.existingOptions).toEqual([
      { id: option.id, name: option.name, price: null, stock: 10, isActive: true },
      { id: otherOption.id, name: otherOption.name, price: null, stock: 10, isActive: true },
    ]);
    const adjusted = await prepared({ kind: "adjust_stock", optionId: option.id, mode: "add", quantity: 1 });
    expect(adjusted.snapshot).toMatchObject({ productUpdatedAt: NOW.toISOString(), optionName: option.name, previousStock: 10, newStock: 11 });
    expect(adjusted.snapshot).not.toHaveProperty("updatedAt");
    expectNoWrites();
  });

  it("counts all duplicates against stock for a sale while invoice stock is informational", async () => {
    const lines = [{ ...invoiceRequest.lines[0]!, quantity: 6 }, { ...invoiceRequest.lines[0]!, quantity: 6 }];
    await expect(prepared({ ...receiptRequest, lines })).rejects.toThrow("stock");
    const draft = await prepared({ ...invoiceRequest, lines });
    expect(draft.snapshot.stockBefore).toEqual({ opt_1: 10 });
    expect(draft.snapshot.stockAfter).toEqual({ opt_1: 10 });
    expectNoWrites();
  });

  it("accounts for live stock holds and asks for delivery information", async () => {
    mocks.orderLine.groupBy.mockResolvedValue([{ productOptionId: "opt_1", _sum: { quantity: 9 } }]);
    await expect(prepared(receiptRequest)).rejects.toThrow("stock");
    mocks.orderLine.groupBy.mockResolvedValue([]);
    expect(await resolveDraft(db, scope, { ...receiptRequest, fulfilment: null }, evidence, NOW)).toHaveProperty("question");
    expect(await resolveDraft(db, scope, { ...receiptRequest, fulfilment: "DELIVERY" }, evidence, NOW)).toHaveProperty("question");
  });

  it("rejects mixed amount/lines, missing tracked stock and foreign option patches", async () => {
    expect(() => draftRequestSchema.parse({ ...receiptRequest, amount: { quote: "45,000", amountMinor: 4_500_000 } })).toThrow();
    mocks.product.findFirst.mockResolvedValueOnce(null);
    await expect(prepared({ kind: "create_product", name: "New wig", description: null, price: { quote: "45,000", amountMinor: 4_500_000 }, tracksStock: true, options: [{ name: "Black", price: null, stock: null }] })).rejects.toThrow("stock");
    await expect(prepared({ ...productPatch, isActive: null, options: [{ optionId: "foreign", name: "Other", price: null, stock: 2 }], fields: ["options"] })).rejects.toThrow("Unknown option");
  });

  it("validates stock, checkout holds and active catalog rows before the first invoice payment", async () => {
    const payment: DraftRequest = { kind: "record_invoice_payment", invoiceId: invoice.id, amount: { quote: "45,000", amountMinor: 4_500_000 }, method: "CASH", createReceipt: false };
    mocks.invoice.findFirst.mockResolvedValue({ ...invoice, lines: order.lines });
    for (const badOption of [
      { ...option, stock: 1 },
      { ...option, isActive: false },
      { ...option, product: { ...product, isActive: false } },
    ]) {
      mocks.productOption.findMany.mockResolvedValue([badOption]);
      await expect(prepared(payment)).rejects.toThrow(/stock|inactive/);
    }
    mocks.productOption.findMany.mockResolvedValue([option]);
    mocks.orderLine.groupBy.mockResolvedValue([{ productOptionId: option.id, _sum: { quantity: 9 } }]);
    await expect(prepared(payment)).rejects.toThrow("stock");
    mocks.orderLine.groupBy.mockResolvedValue([]);
    const result = await prepared(payment);
    expect(result.snapshot).toMatchObject({ createsOrder: true, stockBefore: { opt_1: 10 }, stockAfter: { opt_1: 8 } });
    expect(result.snapshot.stockRows).toEqual([objectContaining({ id: option.id, name: option.name, productUpdatedAt: NOW.toISOString(), stock: 10, physicalStockAfter: 8, heldQuantity: 0 })]);
    expectNoWrites();
  });

  it("does not promise an order or stock deduction for a later payment with no linked order", async () => {
    mocks.invoice.findFirst.mockResolvedValue({ ...invoice, status: "PARTIALLY_PAID", amountPaid: new Prisma.Decimal(45000), lines: order.lines });
    const result = await prepared({ kind: "record_invoice_payment", invoiceId: invoice.id, amount: { quote: "45,000", amountMinor: 4_500_000 }, method: "CASH", createReceipt: false });
    expect(result.snapshot).toMatchObject({ createsOrder: false, productLines: [], stockRows: [], stockBefore: {}, stockAfter: {} });
    expect(mocks.productOption.findMany).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("derives cancellation availability after returning physical stock with overcommitted holds", async () => {
    mocks.productOption.findMany.mockResolvedValue([{ ...option, stock: 1 }]);
    mocks.orderLine.groupBy.mockResolvedValue([{ productOptionId: option.id, _sum: { quantity: 3 } }]);
    mocks.order.findFirst.mockResolvedValue({ ...order, lines: [{ ...order.lines[0]!, quantity: 1 }] });
    for (const request of [
      { kind: "update_order", orderId: order.id, status: "CANCELLED" },
      { kind: "void_invoice", invoiceId: invoice.id, cancelOrder: true },
    ] satisfies DraftRequest[]) {
      const result = await prepared(request);
      const stockSnapshot = request.kind === "void_invoice" ? result.snapshot.orderInfo : result.snapshot;
      expect(stockSnapshot).toMatchObject({ stockBefore: { opt_1: 0 }, stockAfter: { opt_1: 0 }, stockRows: [objectContaining({ stock: 1, physicalStockAfter: 2, heldQuantity: 3 })] });
    }
    expectNoWrites();
  });
});

describe("persisted currency capacity", () => {
  const oversized = { quote: "100 million", amountMinor: 10_000_000_000 };
  const trusted = { ...evidence, text: "Use 100 million" };

  it("rejects oversized standalone prices, overrides, option prices and receipt amounts", async () => {
    mocks.product.findFirst.mockResolvedValueOnce(null);
    await expect(prepared({ kind: "create_product", name: "New wig", description: null, price: oversized, tracksStock: false, options: [{ name: "", price: null, stock: null }] }, trusted)).rejects.toThrow("amount is too large");
    mocks.service.findFirst.mockResolvedValueOnce(null);
    await expect(prepared({ kind: "create_service", name: "New service", description: null, price: oversized, duration: 60, bookingMode: "SLOT", availableFrom: "08:00", availableTo: "17:00", checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 30 }, trusted)).rejects.toThrow("amount is too large");
    await expect(prepared({ ...receiptRequest, lines: [], amount: oversized }, trusted)).rejects.toThrow("amount is too large");
    await expect(prepared({ ...invoiceRequest, lines: [{ ...invoiceRequest.lines[0]!, priceOverride: oversized }] }, trusted)).rejects.toThrow("amount is too large");
    await expect(prepared({ ...productPatch, isActive: null, options: [{ optionId: option.id, name: "Black", price: oversized, stock: 10 }], fields: ["options"] }, trusted)).rejects.toThrow("amount is too large");
    expectNoWrites();
  });

  it("rejects a line or document total above Decimal(10,2) even when each catalog price fits", async () => {
    mocks.productOption.findFirst.mockResolvedValue({ ...option, price: new Prisma.Decimal(60000000) });
    await expect(prepared(invoiceRequest)).rejects.toThrow("amount is too large");
    const single = { ...invoiceRequest.lines[0]!, quantity: 1 };
    await expect(prepared({ ...invoiceRequest, lines: [single, { kind: "custom", id: null, name: "Other", quantity: 1, priceOverride: { quote: "60 million", amountMinor: 6_000_000_000 } }] }, { ...evidence, text: "Use 60 million" })).rejects.toThrow("amount is too large");
    expectNoWrites();
  });

  it("accepts the exact maximum persisted minor amount", async () => {
    const price = { quote: "99,999,999.99", amountMinor: 9_999_999_999 };
    const result = await prepared({ ...receiptRequest, lines: [], amount: price }, { ...evidence, text: `Use ${price.quote}` });
    expect(result.payload.totalMinor).toBe(price.amountMinor);
  });
});

describe("booking domain parity", () => {
  it("retains booked units and nightly checkout time instead of multiplying duration", async () => {
    mocks.booking.findFirst.mockResolvedValueOnce({ ...booking, units: 3, service: { ...service, bookingMode: "NIGHTLY", checkInTime: "14:00", checkOutTime: "12:00", minUnits: 5 } }).mockResolvedValueOnce(null);
    const result = await prepared({ kind: "update_booking", bookingId: booking.id, startTime: "2026-11-08T14:00:00Z", status: null });
    expect(result.payload).toMatchObject({ startTime: "2026-11-08T14:00:00.000Z", endTime: "2026-11-11T12:00:00.000Z", units: 3 });
    expect(mocks.booking.findFirst).toHaveBeenLastCalledWith(objectContaining({ where: objectContaining({ serviceId: service.id, id: { not: booking.id } }) }));
    expect(result.snapshot.calendarSyncNeeded).toBe(true);
  });

  it("uses 24 hour rental days and excludes the moved booking from slot conflicts", async () => {
    mocks.booking.findFirst.mockResolvedValueOnce({ ...booking, units: 2, service: { ...service, bookingMode: "DAILY" } }).mockResolvedValueOnce(null);
    expect((await prepared({ kind: "update_booking", bookingId: booking.id, startTime: "2026-11-08T10:00:00Z", status: null })).payload.endTime).toBe("2026-11-10T10:00:00.000Z");
    mocks.booking.findFirst.mockResolvedValueOnce(booking).mockResolvedValueOnce({ id: "conflict" });
    await expect(prepared({ kind: "update_booking", bookingId: booking.id, startTime: "2026-11-08T10:00:00Z", status: null })).rejects.toThrow("already booked");
    expect(mocks.booking.findFirst).toHaveBeenLastCalledWith(objectContaining({ where: objectContaining({ businessId: scope.businessId, service: { bookingMode: "SLOT" }, id: { not: booking.id } }) }));
  });
});

it("validates patch membership, nullable clearing and merged service booking setup", async () => {
  expect(() => draftRequestSchema.parse({ ...customerPatch, fields: ["businessId"] })).toThrow();
  expect(() => draftRequestSchema.parse({ ...customerPatch, fields: ["name"] })).toThrow();
  expect(() => draftRequestSchema.parse({ ...productPatch, fields: [] })).toThrow();
  expect(() => draftRequestSchema.parse({ ...servicePatch, fields: ["duration", "duration"] })).toThrow();
  const cleared = await prepared(customerPatch);
  expect(cleared.payload).toMatchObject({ fields: ["phone"], phone: null });
  await expect(prepared({ ...servicePatch, duration: null, bookingMode: "NIGHTLY", fields: ["bookingMode"] })).rejects.toThrow("checkInTime");
  await expect(prepared({ ...servicePatch, duration: null, availableFrom: "18:00", fields: ["availableFrom"] })).rejects.toThrow("availableFrom");
});

it("covers every normalized action kind with durable evidence and no writes", async () => {
  const requests: DraftRequest[] = [
    invoiceRequest, receiptRequest,
    { kind: "record_invoice_payment", invoiceId: invoice.id, amount: { quote: "45,000", amountMinor: 4_500_000 }, method: "BANK_TRANSFER", createReceipt: true },
    { kind: "void_invoice", invoiceId: invoice.id, cancelOrder: true },
    { kind: "update_order", orderId: order.id, status: "CANCELLED" },
    { kind: "adjust_stock", optionId: option.id, mode: "add", quantity: 2 },
    { kind: "update_booking", bookingId: booking.id, status: "CANCELLED", startTime: null },
    { kind: "create_product", name: "New wig", description: null, price: { quote: "45,000", amountMinor: 4_500_000 }, tracksStock: false, options: [{ name: "", price: null, stock: null }] },
    productPatch,
    { kind: "create_service", name: "New service", description: null, price: { quote: "5,000", amountMinor: 500_000 }, duration: 60, bookingMode: "SLOT", availableFrom: "08:00", availableTo: "17:00", checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 30 },
    servicePatch,
    { kind: "create_customer", name: "New customer", phone: "08035550144", email: null, address: " Lagos ", notes: " Regular " },
    customerPatch,
  ];
  for (const request of requests) {
    if (request.kind === "create_product") mocks.product.findFirst.mockResolvedValueOnce(null);
    if (request.kind === "create_service") mocks.service.findFirst.mockResolvedValueOnce(null);
    if (request.kind === "create_customer") mocks.customer.findMany.mockResolvedValueOnce([]);
    const result = await prepared(request);
    expect(result.kind).toBe(request.kind);
    expect(result.snapshot).toMatchObject({ originalRequest: request, ownerEvidence: evidence, businessId: scope.businessId, businessCurrency: "NGN", resolvedAt: NOW.toISOString() });
  }
  expectNoWrites();
});

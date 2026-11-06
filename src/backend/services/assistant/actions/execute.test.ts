import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  booking: { updateInTransaction: vi.fn(), finalize: vi.fn() },
  customer: { createInTransaction: vi.fn(), updateInTransaction: vi.fn() },
  invoice: { createInTransaction: vi.fn() },
  finalizeInvoice: vi.fn(),
  invoiceMutations: { recordPaymentInTransaction: vi.fn(), updateInTransaction: vi.fn(), finalize: vi.fn() },
  order: { setStatusInTransaction: vi.fn(), finalizeStatus: vi.fn() },
  product: { createInTransaction: vi.fn(), updateInTransaction: vi.fn(), adjustStockInTransaction: vi.fn() },
  requireAvailableStock: vi.fn(), receipt: { createInTransaction: vi.fn() }, finalizeReceipt: vi.fn(),
  service: { createInTransaction: vi.fn(), updateInTransaction: vi.fn() }, emailReceipt: vi.fn(),
  db: { receipt: { findUnique: vi.fn() } },
}));
vi.mock("@/backend/services/booking/mutations", () => ({ bookingMutations: serviceMocks.booking }));
vi.mock("@/backend/services/customer", () => ({ customerService: serviceMocks.customer }));
vi.mock("@/backend/services/invoice", () => ({ invoiceService: serviceMocks.invoice }));
vi.mock("@/backend/services/invoice/finalize", () => ({ finalizeInvoice: serviceMocks.finalizeInvoice }));
vi.mock("@/backend/services/invoice/mutations", () => ({ invoiceMutations: serviceMocks.invoiceMutations }));
vi.mock("@/backend/services/messaging/engine/amount", () => ({ formatMoney: (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}` }));
vi.mock("@/backend/services/order", () => ({ orderService: serviceMocks.order }));
vi.mock("@/backend/services/product", () => ({ productService: serviceMocks.product }));
vi.mock("@/backend/services/product/stock", () => ({ requireAvailableStock: serviceMocks.requireAvailableStock }));
vi.mock("@/backend/services/receipt", () => ({ receiptService: serviceMocks.receipt }));
vi.mock("@/backend/services/receipt/finalize", () => ({ finalizeReceipt: serviceMocks.finalizeReceipt }));
vi.mock("@/backend/services/service", () => ({ serviceService: serviceMocks.service }));
vi.mock("@/backend/services/email/documents", () => ({ emailReceipt: serviceMocks.emailReceipt }));
vi.mock("@/server/db", () => ({ db: serviceMocks.db }));
vi.mock("@/server/share", () => ({
  publicLink: (kind: string, id: string) => `https://sara.test/${kind}/${id}`,
  productLink: (slug: string) => `https://sara.test/products/${slug}`,
  serviceLink: (slug: string) => `https://sara.test/services/${slug}`,
}));

import { BadRequestException } from "@/utils/exceptions";

import type { AssistantScope } from "../types";
import { executeAction, finalizeEffects } from "./execute";
import type { PreparedAction } from "./types";

const bookingMutations = serviceMocks.booking;
const customerService = serviceMocks.customer;
const invoiceService = serviceMocks.invoice;
const finalizeInvoice = serviceMocks.finalizeInvoice;
const invoiceMutations = serviceMocks.invoiceMutations;
const orderService = serviceMocks.order;
const productService = serviceMocks.product;
const requireAvailableStock = serviceMocks.requireAvailableStock;
const receiptService = serviceMocks.receipt;
const finalizeReceipt = serviceMocks.finalizeReceipt;
const serviceService = serviceMocks.service;
const emailReceipt = serviceMocks.emailReceipt;
const tx = {
  invoice: { findFirst: vi.fn() },
  order: { findFirst: vi.fn() },
  productOption: { findFirst: vi.fn() },
  product: { findFirst: vi.fn() },
  booking: { findFirst: vi.fn() },
  service: { findFirst: vi.fn() },
  receipt: { findFirst: vi.fn() },
} ;
const transactionClient = tx as unknown as Prisma.TransactionClient;
const mocked = serviceMocks.db;
const scope: AssistantScope = { businessId: "business-1", channel: "WHATSAPP", principalId: "owner-1" };
const now = new Date("2026-11-04T12:00:00.000Z");
const currency = "NGN";

const line = {
  kind: "product" as const, id: "option-1", name: "Shea butter", description: null,
  quantity: 3, unitPriceMinor: 500000, totalMinor: 1500000,
  serviceId: null, productOptionId: "option-1",
};

const invoice: PreparedAction<"create_invoice"> = {
  kind: "create_invoice",
  payload: {
    customer: { name: "Amaka", phone: null, email: null, address: null },
    lines: [line], dueDate: "2026-11-06", notes: null,
    subtotalMinor: 1500000, taxAmountMinor: 0, discountMinor: 0, totalMinor: 1500000, currency,
  },
  snapshot: { businessId: scope.businessId, customerWillBeCreated: false, invoiceEmailWillBeSent: false },
};
const receipt: PreparedAction<"create_receipt"> = {
  kind: "create_receipt",
  payload: {
    customer: null, lines: [line], amountPaidMinor: 1500000,
    subtotalMinor: 1500000, taxAmountMinor: 0, discountMinor: 0, totalMinor: 1500000,
    method: "CASH", fulfilment: "PICKUP", deliveryAddress: null, notes: null, currency,
  },
  snapshot: { businessId: scope.businessId, customerWillBeCreated: false, receiptEmailWillBeSent: false },
};
const payment: PreparedAction<"record_invoice_payment"> = {
  kind: "record_invoice_payment",
  payload: { invoiceId: "invoice-1", amountMinor: 500000, method: "CASH", createReceipt: true, currency },
  snapshot: { businessId: scope.businessId },
};
const voided: PreparedAction<"void_invoice"> = {
  kind: "void_invoice",
  payload: { invoiceId: "invoice-1", cancelOrder: true },
  snapshot: { businessId: scope.businessId },
};
const order: PreparedAction<"update_order"> = {
  kind: "update_order",
  payload: { orderId: "order-1", status: "READY" },
  snapshot: { businessId: scope.businessId },
};
const stock: PreparedAction<"adjust_stock"> = {
  kind: "adjust_stock",
  payload: { optionId: "option-1", mode: "remove", quantity: 3, previousStock: 10, newStock: 7 },
  snapshot: { businessId: scope.businessId },
};
const booking: PreparedAction<"update_booking"> = {
  kind: "update_booking",
  payload: {
    bookingId: "booking-1", status: "CONFIRMED", startTime: null, endTime: null, units: 1,
  },
  snapshot: { businessId: scope.businessId },
};
const rescheduled: PreparedAction<"update_booking"> = {
  kind: "update_booking",
  payload: {
    bookingId: "booking-1", status: null,
    startTime: "2026-11-05T10:00:00.000Z", endTime: "2026-11-05T10:30:00.000Z", units: 1,
  },
  snapshot: { businessId: scope.businessId },
};
const createProduct: PreparedAction<"create_product"> = {
  kind: "create_product",
  payload: {
    name: "Cocoa soap", description: null, priceMinor: 200000, tracksStock: true,
    options: [{ name: "Standard", priceMinor: null, stock: 10 }],
  },
  snapshot: { businessId: scope.businessId },
};
const updateProduct: PreparedAction<"update_product"> = {
  kind: "update_product",
  payload: {
    productId: "product-1", name: null, description: null, priceMinor: null,
    isActive: false, tracksStock: null, options: null, fields: ["isActive"],
  },
  snapshot: { businessId: scope.businessId },
};
const createService: PreparedAction<"create_service"> = {
  kind: "create_service",
  payload: {
    name: "Gele touch-up", description: null, priceMinor: 500000, duration: 30,
    bookingMode: "SLOT", availableFrom: "09:00", availableTo: "17:00",
    checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 1,
  },
  snapshot: { businessId: scope.businessId },
};
const updateService: PreparedAction<"update_service"> = {
  kind: "update_service",
  payload: {
    serviceId: "service-1", name: null, description: null, priceMinor: 2000000,
    isActive: null, duration: null, bookingMode: null, availableFrom: null, availableTo: null,
    checkInTime: null, checkOutTime: null, minUnits: null, maxUnits: null, fields: ["price"],
  },
  snapshot: { businessId: scope.businessId },
};
const createCustomer: PreparedAction<"create_customer"> = {
  kind: "create_customer",
  payload: { name: "Zainab", phone: "+2348035550199", email: null, address: null, notes: null },
  snapshot: { businessId: scope.businessId },
};
const updateCustomer: PreparedAction<"update_customer"> = {
  kind: "update_customer",
  payload: {
    customerId: "customer-1", name: "Zainab Bello", phone: null, email: null,
    address: null, notes: null, fields: ["name"],
  },
  snapshot: { businessId: scope.businessId },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(invoiceService.createInTransaction).mockResolvedValue({
    id: "invoice-1", invoiceNumber: "INV-1001", publicId: "public-invoice",
  });
  vi.mocked(receiptService.createInTransaction).mockResolvedValue({
    id: "receipt-1", receiptNumber: "RCP-1001", publicId: "public-receipt",
  });
  vi.mocked(invoiceMutations.recordPaymentInTransaction).mockResolvedValue({
    invoice: { id: "invoice-1", invoiceNumber: "INV-1001", publicId: "public-invoice" },
    receiptId: null,
    effects: [{ kind: "invoice_pdf", id: "invoice-1" }],
  });
  vi.mocked(invoiceMutations.updateInTransaction).mockResolvedValue({
    invoice: { id: "invoice-1", invoiceNumber: "INV-1001", publicId: "public-invoice" },
    effects: [],
  });
  vi.mocked(orderService.setStatusInTransaction).mockResolvedValue({
    order: { id: "order-1", orderNumber: "ORD-1001", publicId: "public-order" },
    effects: [{ kind: "order_email", id: "order-1" }],
  });
  vi.mocked(productService.adjustStockInTransaction).mockResolvedValue({ id: "option-1", stock: 7 });
  vi.mocked(productService.createInTransaction).mockResolvedValue({ id: "product-1", name: "Cocoa soap", slug: "cocoa-soap" });
  vi.mocked(productService.updateInTransaction).mockResolvedValue({ id: "product-1", name: "Shea butter", slug: "shea-butter" });
  vi.mocked(bookingMutations.updateInTransaction).mockResolvedValue({
    booking: { id: "booking-1", clientName: "Amaka", publicId: "public-booking" },
    effects: [],
  });
  vi.mocked(serviceService.createInTransaction).mockResolvedValue({ id: "service-1", name: "Gele touch-up", slug: "gele-touch-up" });
  vi.mocked(serviceService.updateInTransaction).mockResolvedValue({ id: "service-1", name: "Gele tying", slug: "gele-tying" });
  vi.mocked(customerService.createInTransaction).mockResolvedValue({ id: "customer-1", name: "Zainab" });
  vi.mocked(customerService.updateInTransaction).mockResolvedValue({ id: "customer-1", name: "Zainab Bello" });
  vi.mocked(requireAvailableStock).mockResolvedValue(undefined);

  tx.invoice.findFirst.mockResolvedValue({
    id: "invoice-1", slug: "inv-1", publicId: "public-invoice", invoiceNumber: "INV-1001",
    amountPaid: new Prisma.Decimal(0), order: null,
    lines: [{ productOptionId: "option-1", quantity: 3 }],
  });
  tx.order.findFirst.mockResolvedValue({ slug: "ord-1", publicId: "public-order", orderNumber: "ORD-1001" });
  tx.productOption.findFirst.mockResolvedValue({ id: "option-1", name: "Shea", product: { name: "Shea butter", slug: "shea-butter" } });
  tx.product.findFirst.mockResolvedValue({ slug: "shea-butter", name: "Shea butter" });
  tx.booking.findFirst.mockResolvedValue({
    slug: "bkg-1", publicId: "public-booking", clientName: "Amaka", status: "PENDING",
    service: { name: "Gele tying" },
  });
  tx.service.findFirst.mockResolvedValue({ slug: "gele-tying", name: "Gele tying" });
  tx.receipt.findFirst.mockResolvedValue(null);
});

describe("executeAction", () => {
  it("creates an unpaid invoice inside the transaction and queues its PDF", async () => {
    const executed = await executeAction(transactionClient, scope, invoice, now);
    expect(invoiceService.createInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({
      businessId: scope.businessId,
      status: "SENT",
      customerId: null,
      total: 15000,
      sentAt: now,
      lines: [expect.objectContaining({ productOptionId: "option-1", quantity: 3, unitPrice: 5000 })],
    }));
    expect(executed.result).toMatchObject({
      resourceId: "invoice-1",
      link: "https://sara.test/invoice/public-invoice",
      affected: ["invoices", "dashboard"],
    });
    expect(executed.effects).toEqual([{ kind: "invoice_pdf", id: "invoice-1" }]);
  });

  it("preflights available stock before a sale receipt and creates the order in the same transaction", async () => {
    const executed = await executeAction(transactionClient, scope, receipt, now);
    expect(requireAvailableStock).toHaveBeenCalledWith(tx, scope.businessId, [{ productOptionId: "option-1", quantity: 3 }], now);
    expect(receiptService.createInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({
      total: 15000,
      amountPaid: 15000,
      paymentMethod: "CASH",
      sale: { fulfilment: "PICKUP", deliveryAddress: null },
    }));
    expect(executed.result.affected).toEqual(["receipts", "orders", "products", "dashboard"]);
  });

  it("refuses a product receipt without pickup or delivery before writing", async () => {
    const missing = { ...receipt, payload: { ...receipt.payload, fulfilment: null } } as PreparedAction<"create_receipt">;
    await expect(executeAction(transactionClient, scope, missing, now)).rejects.toBeInstanceOf(BadRequestException);
    expect(receiptService.createInTransaction).not.toHaveBeenCalled();
  });

  it("preflights stock for a real first invoice product payment", async () => {
    await executeAction(transactionClient, scope, payment, now);
    expect(requireAvailableStock).toHaveBeenCalledWith(tx, scope.businessId, [{ productOptionId: "option-1", quantity: 3 }], now);
    expect(invoiceMutations.recordPaymentInTransaction).toHaveBeenCalledWith(tx, scope.businessId, "invoice-1", {
      amountMinor: 500000, method: "CASH", createReceipt: true, paidAt: now,
    });
  });

  it("does not preflight stock for a later payment or an invoice that already has an order", async () => {
    tx.invoice.findFirst.mockResolvedValue({
      id: "invoice-1", slug: "inv-1", publicId: "public-invoice", invoiceNumber: "INV-1001",
      amountPaid: new Prisma.Decimal(30000), order: null,
      lines: [{ productOptionId: "option-1", quantity: 3 }],
    });
    await executeAction(transactionClient, scope, payment, now);
    expect(requireAvailableStock).not.toHaveBeenCalled();

    tx.invoice.findFirst.mockResolvedValue({
      id: "invoice-1", slug: "inv-1", publicId: "public-invoice", invoiceNumber: "INV-1001",
      amountPaid: new Prisma.Decimal(0), order: { id: "order-1" },
      lines: [{ productOptionId: "option-1", quantity: 3 }],
    });
    await executeAction(transactionClient, scope, payment, now);
    expect(requireAvailableStock).not.toHaveBeenCalled();
  });

  it("voids the invoice and cancels an eligible order in the same transaction", async () => {
    tx.invoice.findFirst.mockResolvedValue({
      slug: "inv-1", publicId: "public-invoice", invoiceNumber: "INV-1001",
      order: { id: "order-1", orderNumber: "ORD-1001", status: "READY" },
    });
    const executed = await executeAction(transactionClient, scope, voided, now);
    expect(invoiceMutations.updateInTransaction).toHaveBeenCalledWith(tx, scope.businessId, "inv-1", {
      status: "VOID", cancelOrder: true,
    });
    expect(executed.result.affected).toEqual(["invoices", "orders", "products", "dashboard"]);
    expect(executed.result.text).toContain("Order ORD-1001 cancelled");
  });

  it("moves an order and returns its email effect", async () => {
    const executed = await executeAction(transactionClient, scope, order, now);
    expect(orderService.setStatusInTransaction).toHaveBeenCalledWith(tx, scope.businessId, "ord-1", "READY");
    expect(executed.result.text).toContain("marked ready");
    expect(executed.effects).toEqual([{ kind: "order_email", id: "order-1" }]);
  });

  it("maps remove and set stock modes to the physical adjustment the owner approved", async () => {
    await executeAction(transactionClient, scope, stock, now);
    expect(productService.adjustStockInTransaction).toHaveBeenCalledWith(tx, scope.businessId, "option-1", { add: -3 });

    const set = { ...stock, payload: { ...stock.payload, mode: "set", quantity: 2 } } as PreparedAction<"adjust_stock">;
    await executeAction(transactionClient, scope, set, now);
    expect(productService.adjustStockInTransaction).toHaveBeenLastCalledWith(tx, scope.businessId, "option-1", { set: 2 });
  });

  it("confirms a booking and reschedules one with computed end times", async () => {
    await executeAction(transactionClient, scope, booking, now);
    expect(bookingMutations.updateInTransaction).toHaveBeenCalledWith(tx, scope.businessId, "bkg-1", { status: "CONFIRMED" });

    await executeAction(transactionClient, scope, rescheduled, now);
    expect(bookingMutations.updateInTransaction).toHaveBeenLastCalledWith(tx, scope.businessId, "bkg-1", {
      startTime: new Date("2026-11-05T10:00:00.000Z"),
      endTime: new Date("2026-11-05T10:30:00.000Z"),
    });
  });

  it("creates a product with its options and no photos", async () => {
    await executeAction(transactionClient, scope, createProduct, now);
    expect(productService.createInTransaction).toHaveBeenCalledWith(tx, scope.businessId, {
      name: "Cocoa soap",
      description: null,
      price: 2000,
      tracksStock: true,
      options: [{ name: "Standard", price: null, stock: 10 }],
    }, []);
  });

  it("updates a product using the approved field list only", async () => {
    await executeAction(transactionClient, scope, updateProduct, now);
    expect(productService.updateInTransaction).toHaveBeenCalledWith(tx, scope.businessId, "shea-butter", { isActive: false });
  });

  it("creates and updates services through the shared atomic cores", async () => {
    await executeAction(transactionClient, scope, createService, now);
    expect(serviceService.createInTransaction).toHaveBeenCalledWith(tx, scope.businessId, expect.objectContaining({
      name: "Gele touch-up", price: 5000, duration: 30, bookingMode: "SLOT", isActive: true,
    }), null);

    await executeAction(transactionClient, scope, updateService, now);
    expect(serviceService.updateInTransaction).toHaveBeenCalledWith(tx, scope.businessId, "gele-tying", { price: 20000 });
  });

  it("creates and updates customers inside the supplied transaction", async () => {
    await executeAction(transactionClient, scope, createCustomer, now);
    expect(customerService.createInTransaction).toHaveBeenCalledWith(tx, {
      businessId: scope.businessId,
      name: "Zainab",
      phone: "+2348035550199",
      email: null,
      address: null,
      notes: null,
    });

    await executeAction(transactionClient, scope, updateCustomer, now);
    expect(customerService.updateInTransaction).toHaveBeenCalledWith(tx, scope.businessId, "customer-1", { name: "Zainab Bello" });
  });
});

describe("finalizeEffects", () => {
  it("isolates a failed PDF and still runs the remaining effects", async () => {
    vi.mocked(finalizeInvoice).mockRejectedValue(new Error("renderer unavailable"));
    vi.mocked(finalizeReceipt).mockResolvedValue(undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(finalizeEffects([
      { kind: "invoice_pdf", id: "invoice-1" },
      { kind: "receipt_pdf", id: "receipt-1" },
    ])).resolves.toBeUndefined();

    expect(finalizeReceipt).toHaveBeenCalledWith("receipt-1");
    expect(warn).toHaveBeenCalledWith("[Assistant] invoice_pdf failed for invoice-1 (unknown)");
    warn.mockRestore();
  });

  it("dispatches email, order and calendar effects after commit", async () => {
    mocked.receipt.findUnique.mockResolvedValue({ id: "receipt-1", email: "amaka@example.test", business: { id: "business-1" } });
    vi.mocked(invoiceMutations.finalize).mockResolvedValue(undefined);
    vi.mocked(orderService.finalizeStatus).mockResolvedValue(undefined);
    vi.mocked(bookingMutations.finalize).mockResolvedValue(undefined);
    vi.mocked(emailReceipt).mockResolvedValue(null);

    await finalizeEffects([
      { kind: "invoice_email", id: "invoice-1" },
      { kind: "receipt_email", id: "receipt-1" },
      { kind: "order_email", id: "order-1" },
      { kind: "booking_sync", id: "booking-1", previousStartTime: "2026-11-04T10:00:00.000Z" },
    ]);

    expect(invoiceMutations.finalize).toHaveBeenCalledWith([{ kind: "invoice_email", id: "invoice-1" }]);
    expect(emailReceipt).toHaveBeenCalled();
    expect(orderService.finalizeStatus).toHaveBeenCalledWith("order-1");
    expect(bookingMutations.finalize).toHaveBeenCalledWith({
      kind: "booking_sync", id: "booking-1", previousStartTime: "2026-11-04T10:00:00.000Z",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";
import type { Effect } from "@/backend/services/assistant/types";

vi.mock("@/server/db", () => {
  const db: any = {
    invoice: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    payment: { create: vi.fn() },
    order: { findUnique: vi.fn() },
    booking: { findFirst: vi.fn() },
    business: { findUnique: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});

vi.mock("@/backend/services/customer", () => ({
  customerService: {
    ownedBy: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/backend/services/lines", () => ({
  resolveDocumentLines: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/backend/services/order", () => ({
  orderService: {
    createFromInvoice: vi.fn().mockResolvedValue(null),
    setStatusInTransaction: vi.fn().mockResolvedValue({
      order: { slug: "ord-slug", status: "CANCELLED" },
      effects: [{ kind: "order_email", id: "ord-1" }],
    }),
    finalizeStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/backend/services/receipt", () => ({
  receiptService: {
    createInTransaction: vi.fn().mockResolvedValue({ id: "rcp_1" }),
  },
  finalizeReceipt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/backend/services/email/documents", () => ({
  emailInvoice: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./finalize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./finalize")>();
  return {
    ...actual,
    finalizeInvoice: vi.fn().mockResolvedValue(undefined),
  };
});

import { db } from "@/server/db";
import { customerService } from "@/backend/services/customer";
import { resolveDocumentLines } from "@/backend/services/lines";
import { orderService } from "@/backend/services/order";
import { finalizeReceipt, receiptService } from "@/backend/services/receipt";
import { emailInvoice } from "@/backend/services/email/documents";
import { finalizeInvoice, invoiceInclude } from "./finalize";
import { invoiceMutations } from "./mutations";

const mockedDb = db as any;
const mockedCustomer = customerService as any;
const mockedLines = resolveDocumentLines as any;
const mockedOrder = orderService as any;
const mockedReceipt = receiptService as any;
const mockedFinalizeInvoice = finalizeInvoice as any;
const mockedFinalizeReceipt = finalizeReceipt as any;
const mockedEmailInvoice = emailInvoice as any;

function makeInvoice(overrides: Partial<any> = {}) {
  const total = overrides.total ?? 90000;
  const amountPaid = overrides.amountPaid ?? 0;
  return {
    id: "inv_1",
    slug: "inv-1",
    publicId: "pub_inv_1",
    invoiceNumber: "INV-1001",
    businessId: "biz_1",
    customerId: "cus_1",
    bookingId: null,
    status: "SENT",
    currency: "NGN",
    subtotal: new Prisma.Decimal(total),
    taxAmount: new Prisma.Decimal(0),
    discount: new Prisma.Decimal(0),
    total: new Prisma.Decimal(total),
    amountPaid: new Prisma.Decimal(amountPaid),
    clientName: "Ada",
    clientEmail: "ada@example.test",
    clientPhone: "08035550142",
    dueAt: null,
    sentAt: null,
    paidAt: null,
    notes: null,
    url: null,
    createdAt: new Date("2026-11-04T10:00:00Z"),
    updatedAt: new Date("2026-11-04T10:00:00Z"),
    business: {
      id: "biz_1",
      name: "Tobi Beauty",
      email: "tobi@example.test",
      phone: null,
      city: null,
      state: null,
      country: null,
      logoUrl: null,
    },
    lines: [
      {
        id: "line_1",
        invoiceId: "inv_1",
        serviceId: "ser_1",
        productOptionId: "opt_1",
        name: "Frontal wig",
        description: null,
        quantity: 1,
        unitPrice: new Prisma.Decimal(total),
        total: new Prisma.Decimal(total),
        position: 0,
        service: null,
      },
    ],
    ...overrides,
  };
}

let txMock: any;

beforeEach(() => {
  vi.clearAllMocks();
  txMock = {
    invoice: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      create: vi.fn().mockResolvedValue({ id: "pay_1" }),
    },
    order: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    booking: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    business: {
      findUnique: vi.fn().mockResolvedValue({ id: "biz_1", name: "Tobi Beauty" }),
    },
  };
  mockedDb.invoice.findFirst.mockImplementation(txMock.invoice.findFirst);
  mockedDb.invoice.findUnique.mockImplementation(txMock.invoice.findUnique);
  mockedDb.invoice.update.mockImplementation(txMock.invoice.update);
  mockedDb.payment.create.mockImplementation(txMock.payment.create);
  mockedDb.order.findUnique.mockImplementation(txMock.order.findUnique);
  mockedDb.booking.findFirst.mockImplementation(txMock.booking.findFirst);
  mockedDb.business.findUnique.mockImplementation(txMock.business.findUnique);
  mockedDb.$transaction.mockImplementation(async (cb: (tx: any) => unknown) => cb(txMock));

  mockedOrder.createFromInvoice.mockResolvedValue(null);
  mockedOrder.setStatusInTransaction.mockResolvedValue({
    order: { slug: "ord-slug", status: "CANCELLED" },
    effects: [{ kind: "order_email", id: "ord-1" }],
  });
  mockedReceipt.createInTransaction.mockResolvedValue({ id: "rcp_1" });
});

describe("invoiceMutations.recordPaymentInTransaction", () => {
  it("rejects a payment above the current balance", async () => {
    txMock.invoice.findFirst.mockResolvedValue(
      makeInvoice({
        status: "PARTIALLY_PAID",
        total: new Prisma.Decimal(90000),
        amountPaid: new Prisma.Decimal(60000),
      }),
    );

    await expect(
      invoiceMutations.recordPaymentInTransaction(txMock, "biz_1", "inv_1", {
        amountMinor: 4_000_000,
        method: "CASH",
        createReceipt: false,
        paidAt: new Date("2026-11-04T10:00:00Z"),
      }),
    ).rejects.toThrow("outstanding");

    expect(txMock.payment.create).not.toHaveBeenCalled();
    expect(txMock.invoice.update).not.toHaveBeenCalled();
  });

  it.each([
    [0, "zero"],
    [-5000, "negative"],
    [100.5, "non-integer float"],
    [NaN, "NaN"],
    [Infinity, "Infinity"],
  ])("rejects %s (%s) amountMinor", async (amountMinor) => {
    await expect(
      invoiceMutations.recordPaymentInTransaction(txMock, "biz_1", "inv_1", {
        amountMinor: amountMinor as number,
        method: "CASH",
        createReceipt: false,
        paidAt: new Date("2026-11-04T10:00:00Z"),
      }),
    ).rejects.toThrow("positive whole number of minor units");

    expect(txMock.invoice.findFirst).not.toHaveBeenCalled();
    expect(txMock.payment.create).not.toHaveBeenCalled();
  });

  it("rejects invalid payment method (must be CASH or BANK_TRANSFER)", async () => {
    await expect(
      invoiceMutations.recordPaymentInTransaction(txMock, "biz_1", "inv_1", {
        amountMinor: 500000,
        method: "CARD" as any,
        createReceipt: false,
        paidAt: new Date("2026-11-04T10:00:00Z"),
      }),
    ).rejects.toThrow("Choose cash or bank transfer");

    expect(txMock.payment.create).not.toHaveBeenCalled();
  });

  it.each([
    [new Date("invalid-date"), "invalid Date object"],
    ["2026-11-04" as any, "string instead of Date"],
  ])("rejects invalid date: %s", async (paidAt) => {
    await expect(
      invoiceMutations.recordPaymentInTransaction(txMock, "biz_1", "inv_1", {
        amountMinor: 500000,
        method: "CASH",
        createReceipt: false,
        paidAt,
      }),
    ).rejects.toThrow("valid payment date");

    expect(txMock.payment.create).not.toHaveBeenCalled();
  });

  it.each(["PAID", "VOID"])("rejects payment on %s invoices", async (status) => {
    txMock.invoice.findFirst.mockResolvedValue(
      makeInvoice({
        status,
        total: new Prisma.Decimal(90000),
        amountPaid: new Prisma.Decimal(status === "PAID" ? 90000 : 0),
      }),
    );

    await expect(
      invoiceMutations.recordPaymentInTransaction(txMock, "biz_1", "inv_1", {
        amountMinor: 1_000_000,
        method: "CASH",
        createReceipt: false,
        paidAt: new Date("2026-11-04T10:00:00Z"),
      }),
    ).rejects.toThrow("cannot record further payments");

    expect(txMock.payment.create).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when foreign invoice (mismatched businessId or id)", async () => {
    txMock.invoice.findFirst.mockResolvedValue(null);

    await expect(
      invoiceMutations.recordPaymentInTransaction(txMock, "foreign_biz", "inv_1", {
        amountMinor: 1_000_000,
        method: "CASH",
        createReceipt: false,
        paidAt: new Date("2026-11-04T10:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(txMock.invoice.findFirst).toHaveBeenCalledWith({
      where: { id: "inv_1", businessId: "foreign_biz" },
      include: invoiceInclude,
    });
    expect(txMock.payment.create).not.toHaveBeenCalled();
  });

  it("partial payment updates amountPaid and status to PARTIALLY_PAID, creates Payment record", async () => {
    const inv = makeInvoice({
      total: new Prisma.Decimal(90000),
      amountPaid: new Prisma.Decimal(0),
      status: "SENT",
    });
    txMock.invoice.findFirst.mockResolvedValue(inv);
    txMock.invoice.update.mockImplementation(async ({ data }: any) => ({
      ...inv,
      ...data,
    }));

    const paidDate = new Date("2026-11-04T10:00:00Z");
    const result = await invoiceMutations.recordPaymentInTransaction(
      txMock,
      "biz_1",
      "inv_1",
      {
        amountMinor: 4_000_000, // 40,000 NGN
        method: "CASH",
        createReceipt: false,
        paidAt: paidDate,
      },
    );

    expect(txMock.payment.create).toHaveBeenCalledWith({
      data: {
        businessId: "biz_1",
        invoiceId: "inv_1",
        customerId: "cus_1",
        amount: new Prisma.Decimal(40000),
        method: "CASH",
        clientName: "Ada",
        clientEmail: "ada@example.test",
        clientPhone: "08035550142",
      },
    });

    expect(txMock.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv_1" },
      data: {
        amountPaid: new Prisma.Decimal(40000),
        status: "PARTIALLY_PAID",
        paidAt: null,
      },
      include: invoiceInclude,
    });

    expect(result.receiptId).toBeNull();
    expect(result.invoice.status).toBe("PARTIALLY_PAID");
    expect(result.invoice.amountPaid).toEqual(new Prisma.Decimal(40000));
    expect(result.effects).toEqual([{ kind: "invoice_pdf", id: "inv_1" }]);
  });

  it("full payment updates amountPaid and status to PAID, sets paidAt", async () => {
    const inv = makeInvoice({
      total: new Prisma.Decimal(90000),
      amountPaid: new Prisma.Decimal(50000),
      status: "PARTIALLY_PAID",
    });
    txMock.invoice.findFirst.mockResolvedValue(inv);
    txMock.invoice.update.mockImplementation(async ({ data }: any) => ({
      ...inv,
      ...data,
    }));

    const paidDate = new Date("2026-11-04T12:00:00Z");
    const result = await invoiceMutations.recordPaymentInTransaction(
      txMock,
      "biz_1",
      "inv_1",
      {
        amountMinor: 4_000_000, // 40,000 NGN settles remaining 40,000
        method: "BANK_TRANSFER",
        createReceipt: false,
        paidAt: paidDate,
      },
    );

    expect(txMock.payment.create).toHaveBeenCalledWith({
      data: {
        businessId: "biz_1",
        invoiceId: "inv_1",
        customerId: "cus_1",
        amount: new Prisma.Decimal(40000),
        method: "BANK_TRANSFER",
        clientName: "Ada",
        clientEmail: "ada@example.test",
        clientPhone: "08035550142",
      },
    });

    expect(txMock.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv_1" },
      data: {
        amountPaid: new Prisma.Decimal(90000),
        status: "PAID",
        paidAt: paidDate,
      },
      include: invoiceInclude,
    });

    expect(result.invoice.status).toBe("PAID");
    expect(result.invoice.amountPaid).toEqual(new Prisma.Decimal(90000));
    expect(result.invoice.paidAt).toEqual(paidDate);
    expect(result.effects).toEqual([{ kind: "invoice_pdf", id: "inv_1" }]);
  });

  it("first payment on invoice with product lines calls orderService.createFromInvoice(tx, invoice.id)", async () => {
    const inv = makeInvoice({
      total: new Prisma.Decimal(90000),
      amountPaid: new Prisma.Decimal(0),
    });
    txMock.invoice.findFirst.mockResolvedValue(inv);
    txMock.invoice.update.mockResolvedValue({
      ...inv,
      amountPaid: new Prisma.Decimal(30000),
      status: "PARTIALLY_PAID",
    });

    await invoiceMutations.recordPaymentInTransaction(txMock, "biz_1", "inv_1", {
      amountMinor: 3_000_000,
      method: "CASH",
      createReceipt: false,
      paidAt: new Date("2026-11-04T10:00:00Z"),
    });

    expect(orderService.createFromInvoice).toHaveBeenCalledTimes(1);
    expect(orderService.createFromInvoice).toHaveBeenCalledWith(txMock, "inv_1");
  });

  it("second payment on already partially-paid invoice does NOT call orderService.createFromInvoice", async () => {
    const inv = makeInvoice({
      total: new Prisma.Decimal(90000),
      amountPaid: new Prisma.Decimal(30000),
      status: "PARTIALLY_PAID",
    });
    txMock.invoice.findFirst.mockResolvedValue(inv);
    txMock.invoice.update.mockResolvedValue({
      ...inv,
      amountPaid: new Prisma.Decimal(60000),
      status: "PARTIALLY_PAID",
    });

    await invoiceMutations.recordPaymentInTransaction(txMock, "biz_1", "inv_1", {
      amountMinor: 3_000_000,
      method: "CASH",
      createReceipt: false,
      paidAt: new Date("2026-11-04T10:00:00Z"),
    });

    expect(orderService.createFromInvoice).not.toHaveBeenCalled();
  });

  it("createReceipt: true calls receiptService.createInTransaction with paymentId and returns receiptId and effect { kind: 'receipt_pdf', id }", async () => {
    const inv = makeInvoice({
      total: new Prisma.Decimal(90000),
      amountPaid: new Prisma.Decimal(0),
      currency: "NGN",
      clientName: "Ada",
      clientEmail: "ada@example.test",
      clientPhone: "08035550142",
    });
    txMock.invoice.findFirst.mockResolvedValue(inv);
    txMock.payment.create.mockResolvedValue({ id: "pay_xyz" });
    txMock.invoice.update.mockResolvedValue({
      ...inv,
      amountPaid: new Prisma.Decimal(40000),
      status: "PARTIALLY_PAID",
    });
    mockedReceipt.createInTransaction.mockResolvedValue({ id: "rcp_abc" });

    const result = await invoiceMutations.recordPaymentInTransaction(
      txMock,
      "biz_1",
      "inv_1",
      {
        amountMinor: 4_000_000,
        method: "BANK_TRANSFER",
        createReceipt: true,
        paidAt: new Date("2026-11-04T10:00:00Z"),
      },
    );

    expect(receiptService.createInTransaction).toHaveBeenCalledWith(txMock, {
      businessId: "biz_1",
      customerId: "cus_1",
      paymentId: "pay_xyz",
      name: "Ada",
      email: "ada@example.test",
      phone: "08035550142",
      currency: "NGN",
      subtotal: 40000,
      taxAmount: 0,
      discount: 0,
      total: 40000,
      amountPaid: 40000,
      paymentMethod: "BANK_TRANSFER",
    });

    expect(result.receiptId).toBe("rcp_abc");
    expect(result.effects).toEqual([
      { kind: "invoice_pdf", id: "inv_1" },
      { kind: "receipt_pdf", id: "rcp_abc" },
    ]);
  });
});

describe("invoiceMutations.updateInTransaction", () => {
  it("throws NotFoundException when invoice does not exist for business", async () => {
    txMock.invoice.findFirst.mockResolvedValue(null);

    await expect(
      invoiceMutations.updateInTransaction(txMock, "biz_1", "non-existent", {
        notes: "test",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(txMock.invoice.findFirst).toHaveBeenCalledWith({
      where: { slug: "non-existent", businessId: "biz_1" },
      include: invoiceInclude,
    });
    expect(txMock.invoice.update).not.toHaveBeenCalled();
  });

  it("rejects updates to a PAID invoice", async () => {
    txMock.invoice.findFirst.mockResolvedValue(
      makeInvoice({ status: "PAID", amountPaid: 90000, total: 90000 }),
    );

    await expect(
      invoiceMutations.updateInTransaction(txMock, "biz_1", "inv-1", {
        notes: "New notes",
      }),
    ).rejects.toThrow("Invoice cannot be updated");

    expect(txMock.invoice.update).not.toHaveBeenCalled();
  });

  it("rejects non-payment fields on a PARTIALLY_PAID invoice", async () => {
    txMock.invoice.findFirst.mockResolvedValue(
      makeInvoice({ status: "PARTIALLY_PAID", amountPaid: 40000, total: 90000 }),
    );

    await expect(
      invoiceMutations.updateInTransaction(txMock, "biz_1", "inv-1", {
        name: "Renamed Customer",
      }),
    ).rejects.toThrow("A part-paid invoice can only record further payments");

    expect(txMock.invoice.update).not.toHaveBeenCalled();
  });

  it("permits payment-related fields on a PARTIALLY_PAID invoice", async () => {
    const inv = makeInvoice({
      status: "PARTIALLY_PAID",
      amountPaid: 40000,
      total: 90000,
    });
    txMock.invoice.findFirst.mockResolvedValue(inv);
    txMock.invoice.update.mockImplementation(async ({ data }: any) => ({
      ...inv,
      ...data,
    }));

    const paidAt = new Date("2026-11-04T15:00:00Z");
    const result = await invoiceMutations.updateInTransaction(
      txMock,
      "biz_1",
      "inv-1",
      {
        status: "PAID",
        amountPaid: 90000,
        paidAt,
      },
    );

    expect(txMock.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv_1" },
      data: expect.objectContaining({
        status: "PAID",
        amountPaid: 90000,
        paidAt,
      }),
      include: invoiceInclude,
    });
    expect(result.invoice.status).toBe("PAID");
  });

  it("rejects when amountPaid exceeds the invoice total", async () => {
    txMock.invoice.findFirst.mockResolvedValue(
      makeInvoice({ status: "SENT", total: 90000, amountPaid: 0 }),
    );

    await expect(
      invoiceMutations.updateInTransaction(txMock, "biz_1", "inv-1", {
        amountPaid: 100000,
      }),
    ).rejects.toThrow("amountPaid cannot exceed the invoice total");

    expect(txMock.invoice.update).not.toHaveBeenCalled();
  });

  it("rejects when amountPaid is reduced", async () => {
    txMock.invoice.findFirst.mockResolvedValue(
      makeInvoice({ status: "PARTIALLY_PAID", total: 90000, amountPaid: 50000 }),
    );

    await expect(
      invoiceMutations.updateInTransaction(txMock, "biz_1", "inv-1", {
        amountPaid: 40000,
      }),
    ).rejects.toThrow("amountPaid cannot be reduced");

    expect(txMock.invoice.update).not.toHaveBeenCalled();
  });

  it("rejects further payments on a VOID invoice", async () => {
    txMock.invoice.findFirst.mockResolvedValue(
      makeInvoice({ status: "VOID", total: 90000, amountPaid: 30000 }),
    );

    await expect(
      invoiceMutations.updateInTransaction(txMock, "biz_1", "inv-1", {
        amountPaid: 50000,
      }),
    ).rejects.toThrow("A void invoice cannot record further payments");

    expect(txMock.invoice.update).not.toHaveBeenCalled();
  });

  it("handles patch details: connects validated booking and customer, resolves lines", async () => {
    const inv = makeInvoice({ status: "DRAFT", total: 90000, amountPaid: 0 });
    txMock.invoice.findFirst.mockResolvedValue(inv);
    txMock.booking.findFirst.mockResolvedValue({ id: "bkg_1", businessId: "biz_1" });
    mockedCustomer.ownedBy.mockResolvedValue(undefined);
    mockedLines.mockResolvedValue([
      { name: "Hair styling", quantity: 1, unitPrice: 50000, total: 50000, position: 0 },
    ]);
    txMock.invoice.update.mockImplementation(async ({ data }: any) => ({
      ...inv,
      ...data,
    }));

    const result = await invoiceMutations.updateInTransaction(
      txMock,
      "biz_1",
      "inv-1",
      {
        name: "Ada Lovelace",
        email: "ada@example.test",
        phone: "08035550142",
        bookingId: "bkg_1",
        customerId: "cus_1",
        lines: [{ name: "Hair styling", quantity: 1, unitPrice: 50000, total: 50000 }],
        notes: "Important appointment",
      },
    );

    expect(txMock.booking.findFirst).toHaveBeenCalledWith({
      where: { id: "bkg_1", businessId: "biz_1" },
    });
    expect(mockedCustomer.ownedBy).toHaveBeenCalledWith(txMock, "biz_1", "cus_1");
    expect(mockedLines).toHaveBeenCalledWith(txMock, "biz_1", expect.any(Array));

    expect(txMock.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv_1" },
      data: expect.objectContaining({
        clientName: "Ada Lovelace",
        clientEmail: "ada@example.test",
        clientPhone: "08035550142",
        booking: { connect: { id: "bkg_1" } },
        customer: { connect: { id: "cus_1" } },
        notes: "Important appointment",
        lines: {
          deleteMany: {},
          create: expect.any(Array),
        },
      }),
      include: invoiceInclude,
    });
    expect(result.invoice).toBeDefined();
  });

  it("rejects bookingId when booking belongs to another business", async () => {
    txMock.invoice.findFirst.mockResolvedValue(makeInvoice({ status: "DRAFT" }));
    txMock.booking.findFirst.mockResolvedValue(null);

    await expect(
      invoiceMutations.updateInTransaction(txMock, "biz_1", "inv-1", {
        bookingId: "bkg_foreign",
      }),
    ).rejects.toThrow("Booking not found for this business");

    expect(txMock.invoice.update).not.toHaveBeenCalled();
  });

  it("creates order on first payment against an unpaid invoice", async () => {
    const inv = makeInvoice({
      status: "SENT",
      total: 90000,
      amountPaid: 0,
    });
    txMock.invoice.findFirst.mockResolvedValue(inv);
    txMock.invoice.update.mockResolvedValue({
      ...inv,
      amountPaid: new Prisma.Decimal(45000),
      status: "PARTIALLY_PAID",
    });

    await invoiceMutations.updateInTransaction(txMock, "biz_1", "inv-1", {
      status: "PARTIALLY_PAID",
      amountPaid: 45000,
    });

    expect(orderService.createFromInvoice).toHaveBeenCalledTimes(1);
    expect(orderService.createFromInvoice).toHaveBeenCalledWith(txMock, "inv_1");
  });

  it("void with cancelOrder cancels order and appends order effects", async () => {
    const inv = makeInvoice({
      status: "PARTIALLY_PAID",
      amountPaid: 45000,
      total: 90000,
    });
    txMock.invoice.findFirst.mockResolvedValue(inv);
    txMock.invoice.update.mockResolvedValue({
      ...inv,
      status: "VOID",
    });
    txMock.order.findUnique.mockResolvedValue({
      slug: "ord-1022",
      status: "NEW",
    });
    mockedOrder.setStatusInTransaction.mockResolvedValue({
      order: { slug: "ord-1022", status: "CANCELLED" },
      effects: [{ kind: "order_email", id: "ord_row_1" }],
    });

    const result = await invoiceMutations.updateInTransaction(
      txMock,
      "biz_1",
      "inv-1",
      {
        status: "VOID",
        cancelOrder: true,
      },
    );

    expect(txMock.order.findUnique).toHaveBeenCalledWith({
      where: { invoiceId: "inv_1" },
      select: { slug: true, status: true },
    });
    expect(orderService.setStatusInTransaction).toHaveBeenCalledWith(
      txMock,
      "biz_1",
      "ord-1022",
      "CANCELLED",
    );
    expect(result.effects).toContainEqual({
      kind: "order_email",
      id: "ord_row_1",
    });
    expect(result.effects).toContainEqual({
      kind: "invoice_pdf",
      id: "inv_1",
    });
  });

  it("void with cancelOrder does not cancel order when order is COMPLETED", async () => {
    const inv = makeInvoice({
      status: "PARTIALLY_PAID",
      amountPaid: 45000,
      total: 90000,
    });
    txMock.invoice.findFirst.mockResolvedValue(inv);
    txMock.invoice.update.mockResolvedValue({ ...inv, status: "VOID" });
    txMock.order.findUnique.mockResolvedValue({
      slug: "ord-1022",
      status: "COMPLETED",
    });

    await invoiceMutations.updateInTransaction(txMock, "biz_1", "inv-1", {
      status: "VOID",
      cancelOrder: true,
    });

    expect(orderService.setStatusInTransaction).not.toHaveBeenCalled();
  });

  it("void without cancelOrder does not look up or cancel the order", async () => {
    const inv = makeInvoice({
      status: "PARTIALLY_PAID",
      amountPaid: 45000,
      total: 90000,
    });
    txMock.invoice.findFirst.mockResolvedValue(inv);
    txMock.invoice.update.mockResolvedValue({ ...inv, status: "VOID" });

    await invoiceMutations.updateInTransaction(txMock, "biz_1", "inv-1", {
      status: "VOID",
    });

    expect(txMock.order.findUnique).not.toHaveBeenCalled();
    expect(orderService.setStatusInTransaction).not.toHaveBeenCalled();
  });
});

describe("invoiceMutations.finalize", () => {
  it("isolates post-commit email failures and continues later effects", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(makeInvoice());
    mockedEmailInvoice.mockRejectedValueOnce(new Error("private provider response"));
    await expect(invoiceMutations.finalize([
      { kind: "invoice_email", id: "inv_1" }, { kind: "order_email", id: "ord_1" },
    ])).resolves.toBeUndefined();
    expect(orderService.finalizeStatus).toHaveBeenCalledWith("ord_1");
  });

  it("runs effects: invoice_pdf, receipt_pdf, order_email, and invoice_email", async () => {
    const committedInvoice = makeInvoice({
      status: "SENT",
      clientEmail: "ada@example.test",
    });
    mockedDb.invoice.findUnique.mockResolvedValue(committedInvoice);

    const effects: Effect[] = [
      { kind: "invoice_pdf", id: "inv_1" },
      { kind: "receipt_pdf", id: "rcp_1" },
      { kind: "order_email", id: "ord_1" },
      { kind: "invoice_email", id: "inv_1" },
    ];

    await invoiceMutations.finalize(effects);

    expect(finalizeInvoice).toHaveBeenCalledWith("inv_1");
    expect(finalizeReceipt).toHaveBeenCalledWith("rcp_1");
    expect(orderService.finalizeStatus).toHaveBeenCalledWith("ord_1");
    expect(mockedDb.invoice.findUnique).toHaveBeenCalledWith({
      where: { id: "inv_1" },
      include: invoiceInclude,
    });
    expect(emailInvoice).toHaveBeenCalledWith(
      committedInvoice,
      committedInvoice.business,
    );
  });

  it("does not send invoice_email when invoice status is DRAFT or client has no email", async () => {
    const draftInvoice = makeInvoice({
      status: "DRAFT",
      clientEmail: "ada@example.test",
    });
    mockedDb.invoice.findUnique.mockResolvedValue(draftInvoice);

    await invoiceMutations.finalize([{ kind: "invoice_email", id: "inv_draft" }]);

    expect(emailInvoice).not.toHaveBeenCalled();

    const noEmailInvoice = makeInvoice({
      status: "SENT",
      clientEmail: null,
    });
    mockedDb.invoice.findUnique.mockResolvedValue(noEmailInvoice);

    await invoiceMutations.finalize([{ kind: "invoice_email", id: "inv_no_email" }]);

    expect(emailInvoice).not.toHaveBeenCalled();
  });
});

describe("invoiceMutations.update (wrapper)", () => {
  it("runs updateInTransaction in serializable transaction, finalizes effects, and reloads invoice", async () => {
    const inv = makeInvoice({ status: "SENT", notes: "Initial notes" });
    txMock.invoice.findFirst.mockResolvedValue(inv);
    const updatedInv = { ...inv, notes: "Updated notes" };
    txMock.invoice.update.mockResolvedValue(updatedInv);
    mockedDb.invoice.findUnique.mockResolvedValue(updatedInv);

    const result = await invoiceMutations.update("biz_1", "inv-1", {
      notes: "Updated notes",
    });

    expect(mockedDb.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
    expect(finalizeInvoice).toHaveBeenCalledWith("inv_1");
    expect(mockedDb.invoice.findUnique).toHaveBeenCalledWith({
      where: { id: "inv_1" },
    });
    expect(result.notes).toBe("Updated notes");
  });
});


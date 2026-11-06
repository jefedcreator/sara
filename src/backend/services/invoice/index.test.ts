import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    invoice: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    booking: { findFirst: vi.fn() },
    service: { findMany: vi.fn() },
    business: { findUnique: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});
vi.mock("@/backend/services/pdf", () => ({
  generateInvoicePdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
}));
vi.mock("@/backend/services/cloudinary", () => ({
  cloudinaryService: {
    uploadImage: vi.fn().mockResolvedValue({ secure_url: "https://cdn.test/INV-1001.pdf" }),
  },
}));
vi.mock("@/backend/services/customer", () => ({
  customerService: {
    resolve: vi.fn(),
    ownedBy: vi.fn(),
  },
}));

import { cloudinaryService } from "@/backend/services/cloudinary";
import { customerService } from "@/backend/services/customer";
import { generateInvoicePdf } from "@/backend/services/pdf";
import { db } from "@/server/db";
import { BadRequestException } from "@/utils/exceptions";
import { invoiceService, type CreateInvoiceInput } from "./index";

const mockedDb = db as any;
const mockedCustomer = customerService as any;
const BUSINESS = { id: "biz_1", name: "Acme Salon", email: null, phone: null, city: null, state: null, country: null, logoUrl: null };

const DOCUMENT = {
  publicId: "public_invoice_1",
  id: "inv_1", slug: "acme-salon-inv-1001", invoiceNumber: "INV-1001",
  business: BUSINESS, lines: [], subtotal: 5000, taxAmount: 0, discount: 0,
  total: 5000, amountPaid: 0, currency: "NGN", status: "SENT",
  dueAt: null, sentAt: null, paidAt: null, notes: "eggs",
  clientName: "Ada", clientEmail: null, clientPhone: null,
};

let txMock: any;

beforeEach(() => {
  vi.clearAllMocks();
  mockedCustomer.resolve.mockResolvedValue({ id: "cus_1" });
  mockedCustomer.ownedBy.mockResolvedValue({ id: "cus_2" });
  mockedDb.business.findUnique.mockResolvedValue(BUSINESS);
  mockedDb.invoice.findFirst.mockResolvedValue(null);
  mockedDb.service.findMany.mockResolvedValue([]);
  mockedDb.invoice.create.mockResolvedValue(DOCUMENT);
  mockedDb.invoice.findUnique.mockResolvedValue(DOCUMENT);
  mockedDb.invoice.update.mockImplementation(async ({ data }: { data: { url: string } }) => {
    const updated = { ...DOCUMENT, ...data };
    mockedDb.invoice.findUnique.mockResolvedValue(updated);
    return updated;
  });

  txMock = {
    business: { findUnique: vi.fn().mockResolvedValue(BUSINESS) },
    invoice: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(DOCUMENT),
      update: vi.fn().mockImplementation(() => {
        throw new Error(
          "Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 6285 ms passed since the start of the transaction.",
        );
      }),
    },
    booking: { findFirst: vi.fn().mockResolvedValue(null) },
    service: { findMany: vi.fn().mockResolvedValue([]) },
  };
  mockedDb.$transaction.mockImplementation(async (cb: (tx: any) => unknown) => cb(txMock));
});

describe("invoiceService.create", () => {
  it("creates the first invoice as INV-1001 and returns the record with a url without calling update on expired tx", async () => {
    const result = await invoiceService.create({
      businessId: "biz_1", name: "Ada", status: "SENT", currency: "NGN",
      subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 0, notes: "eggs",
    });
    expect(txMock.invoice.create.mock.calls[0]![0].data.invoiceNumber).toBe("INV-1001");
    expect(mockedDb.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv_1" },
      data: { url: "https://cdn.test/INV-1001.pdf" },
    });
    expect(result.url).toBe("https://cdn.test/INV-1001.pdf");
  });

  it("still returns the created invoice if PDF generation or upload fails", async () => {
    const { generateInvoicePdf } = await import("@/backend/services/pdf");
    vi.mocked(generateInvoicePdf).mockRejectedValueOnce(new Error("PDF generation timed out"));

    const result = await invoiceService.create({
      businessId: "biz_1", name: "Ada", status: "SENT", currency: "NGN",
      subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 0, notes: "eggs",
    });

    expect(txMock.invoice.create).toHaveBeenCalled();
    expect(result.id).toBe("inv_1");
    expect(result.invoiceNumber).toBe("INV-1001");
    expect(result.publicId).toBe(DOCUMENT.publicId);
    expect(txMock.invoice.create).toHaveBeenCalledTimes(1);
    expect(mockedDb.invoice.update).not.toHaveBeenCalled();
  });

  it("links the invoice to the resolved customer", async () => {
    await invoiceService.create({
      businessId: "biz_1", name: "Ada", phone: "08035550142", status: "SENT",
      currency: "NGN", subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 0,
    });

    expect(mockedCustomer.resolve).toHaveBeenCalledWith(txMock, {
      businessId: "biz_1",
      name: "Ada",
      phone: "08035550142",
      email: undefined,
    });
    expect(txMock.invoice.create.mock.calls[0]![0].data.customerId).toBe("cus_1");
  });

  it("uses an explicit customerId owned by the business", async () => {
    await invoiceService.create({
      businessId: "biz_1", name: "Ada", customerId: "cus_2", status: "SENT",
      currency: "NGN", subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 0,
    });

    expect(mockedCustomer.ownedBy).toHaveBeenCalledWith(txMock, "biz_1", "cus_2");
    expect(mockedCustomer.resolve).not.toHaveBeenCalled();
    expect(txMock.invoice.create.mock.calls[0]![0].data.customerId).toBe("cus_2");
  });

  it("rejects a customerId from another business", async () => {
    mockedCustomer.ownedBy.mockRejectedValue(
      new BadRequestException("Customer not found for this business"),
    );

    await expect(
      invoiceService.create({
        businessId: "biz_1", name: "Ada", customerId: "cus_other", status: "SENT",
        currency: "NGN", subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(txMock.invoice.create).not.toHaveBeenCalled();
  });
});

describe("invoiceService.createInTransaction", () => {
  it("does not reuse global slugs for the same business name and document number", async () => {
    const input: CreateInvoiceInput = { businessId: "biz_1", name: "Ada", status: "SENT", currency: "NGN", subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 0 };
    await invoiceService.createInTransaction(txMock, input);
    await invoiceService.createInTransaction(txMock, input);
    const slugs = txMock.invoice.create.mock.calls.map(([args]: [{ data: { slug: string } }]) => args.data.slug);
    expect(slugs[0]).toMatch(/^acme-salon-inv-1001-/);
    expect(slugs[0]).not.toBe(slugs[1]);
  });
  it("creates through the supplied transaction without opening another or generating a PDF", async () => {
    const outer = { ...txMock, outerMarker: Symbol("approval transaction") };
    outer.service.findMany.mockResolvedValue([{ id: "ser_1", name: "Wig install" }]);
    const input: CreateInvoiceInput = {
      businessId: "biz_1", name: "Tolu", currency: "NGN", status: "SENT",
      subtotal: 90000, taxAmount: 0, discount: 0, total: 90000, amountPaid: 0,
      lines: [{ serviceId: "ser_1", quantity: 2, unitPrice: 45000, total: 90000 }],
    };

    const result = await invoiceService.createInTransaction(outer, input);

    expect(mockedDb.$transaction).not.toHaveBeenCalled();
    expect(mockedDb.business.findUnique).not.toHaveBeenCalled();
    expect(mockedDb.invoice.findUnique).not.toHaveBeenCalled();
    expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
    expect(generateInvoicePdf).not.toHaveBeenCalled();
    expect(mockedDb.invoice.create).not.toHaveBeenCalled();
    expect(mockedDb.service.findMany).not.toHaveBeenCalled();
    expect(mockedCustomer.resolve).toHaveBeenCalledWith(outer, expect.objectContaining({ businessId: "biz_1" }));
    expect(outer.service.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["ser_1"] }, businessId: "biz_1" },
      select: { id: true, name: true },
    });
    expect(outer.invoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lines: { create: [expect.objectContaining({ name: "Wig install", position: 0 })] } }),
      include: { business: true, lines: { include: { service: true }, orderBy: { position: "asc" } } },
    }));
    expect(result).toBe(DOCUMENT);
  });

  it("scopes the booking lookup to the supplied business before writing", async () => {
    await expect(invoiceService.createInTransaction(txMock, {
      businessId: "biz_1", name: "Ada", bookingId: "booking_foreign", status: "SENT", currency: "NGN",
      subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 0,
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(txMock.booking.findFirst).toHaveBeenCalledWith({ where: { id: "booking_foreign", businessId: "biz_1" } });
    expect(txMock.invoice.create).not.toHaveBeenCalled();
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
  });
});

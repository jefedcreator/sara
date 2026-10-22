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

import { customerService } from "@/backend/services/customer";
import { db } from "@/server/db";
import { BadRequestException } from "@/utils/exceptions";
import { invoiceService } from "./index";

const mockedDb = db as any;
const mockedCustomer = customerService as any;
const BUSINESS = { id: "biz_1", name: "Acme Salon", email: null, phone: null, city: null, state: null, country: null, logoUrl: null };

let txMock: any;

beforeEach(() => {
  vi.clearAllMocks();
  mockedCustomer.resolve.mockResolvedValue({ id: "cus_1" });
  mockedCustomer.ownedBy.mockResolvedValue({ id: "cus_2" });
  mockedDb.business.findUnique.mockResolvedValue(BUSINESS);
  mockedDb.invoice.findFirst.mockResolvedValue(null);
  mockedDb.invoice.findUnique.mockResolvedValue(null);
  mockedDb.service.findMany.mockResolvedValue([]);
  mockedDb.invoice.create.mockResolvedValue({
    id: "inv_1", slug: "acme-salon-inv-1001", invoiceNumber: "INV-1001",
    business: BUSINESS, lines: [], subtotal: 5000, taxAmount: 0, discount: 0,
    total: 5000, amountPaid: 0, currency: "NGN", status: "SENT",
    dueAt: null, sentAt: null, paidAt: null, notes: "eggs",
    clientName: "Ada", clientEmail: null, clientPhone: null,
  });
  mockedDb.invoice.update.mockResolvedValue({
    id: "inv_1", slug: "acme-salon-inv-1001", invoiceNumber: "INV-1001",
    url: "https://cdn.test/INV-1001.pdf",
  });

  txMock = {
    business: { findUnique: vi.fn().mockResolvedValue(BUSINESS) },
    invoice: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "inv_1", slug: "acme-salon-inv-1001", invoiceNumber: "INV-1001",
        business: BUSINESS, lines: [], subtotal: 5000, taxAmount: 0, discount: 0,
        total: 5000, amountPaid: 0, currency: "NGN", status: "SENT",
        dueAt: null, sentAt: null, paidAt: null, notes: "eggs",
        clientName: "Ada", clientEmail: null, clientPhone: null,
      }),
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

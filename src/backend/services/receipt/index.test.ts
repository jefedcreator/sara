import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    receipt: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    payment: { findFirst: vi.fn() },
    service: { findMany: vi.fn() },
    business: { findUnique: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});
vi.mock("@/backend/services/pdf", () => ({
  generateReceiptPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
}));
vi.mock("@/backend/services/cloudinary", () => ({
  cloudinaryService: {
    uploadImage: vi.fn().mockResolvedValue({ secure_url: "https://cdn.test/RCP-1001.pdf" }),
  },
}));
vi.mock("@/backend/services/customer", () => ({
  customerService: {
    resolve: vi.fn(),
    ownedBy: vi.fn(),
  },
}));

vi.mock("@/backend/services/paystack", () => ({ paystackService: {} }));
vi.mock("@/backend/services/email", () => ({ emailService: {} }));

import { customerService } from "@/backend/services/customer";
import { orderService } from "@/backend/services/order";
import { db } from "@/server/db";
import { BadRequestException } from "@/utils/exceptions";
import { receiptService } from "./index";

const mockedDb = db as any;
const mockedCustomer = customerService as any;
const BUSINESS = { id: "biz_1", name: "Acme Salon", email: null, phone: null, city: null, state: null, country: null, logoUrl: null };

let txMock: any;
let createFromReceipt: MockInstance<typeof orderService.createFromReceipt>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedCustomer.resolve.mockResolvedValue({ id: "cus_1" });
  mockedCustomer.ownedBy.mockResolvedValue({ id: "cus_2" });
  mockedDb.business.findUnique.mockResolvedValue(BUSINESS);
  mockedDb.receipt.findFirst.mockResolvedValue(null);
  mockedDb.service.findMany.mockResolvedValue([]);
  mockedDb.receipt.create.mockResolvedValue({
    id: "rcp_1", slug: "acme-salon-rcp-1001", receiptNumber: "RCP-1001",
    business: BUSINESS, lines: [], currency: "NGN", subtotal: 5000, taxAmount: 0,
    discount: 0, total: 5000, amountPaid: 5000, paymentMethod: null, notes: "gele",
    name: "Ada", email: null, phone: null, createdAt: new Date(),
  });
  mockedDb.receipt.update.mockResolvedValue({
    id: "rcp_1", slug: "acme-salon-rcp-1001", receiptNumber: "RCP-1001",
    url: "https://cdn.test/RCP-1001.pdf",
  });

  txMock = {
    business: { findUnique: vi.fn().mockResolvedValue(BUSINESS) },
    payment: { findFirst: vi.fn().mockResolvedValue(null) },
    service: { findMany: vi.fn().mockResolvedValue([]) },
    receipt: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "rcp_1", slug: "acme-salon-rcp-1001", receiptNumber: "RCP-1001",
        business: BUSINESS, lines: [], currency: "NGN", subtotal: 5000, taxAmount: 0,
        discount: 0, total: 5000, amountPaid: 5000, paymentMethod: null, notes: "gele",
        name: "Ada", email: null, phone: null, createdAt: new Date(),
      }),
      update: vi.fn().mockImplementation(() => {
        throw new Error(
          "Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction.",
        );
      }),
    },
  };
  mockedDb.$transaction.mockImplementation(async (cb: (tx: any) => unknown) => cb(txMock));

  // Calls through to the real service unless a test says otherwise.
  createFromReceipt = vi.spyOn(orderService, "createFromReceipt");
});

describe("receiptService.create", () => {
  it("creates the first receipt as RCP-1001 and returns the record with a url without calling update on expired tx", async () => {
    const result = await receiptService.create({
      businessId: "biz_1", name: "Ada", currency: "NGN",
      subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 5000, notes: "gele",
    });
    expect(txMock.receipt.create.mock.calls[0]![0].data.receiptNumber).toBe("RCP-1001");
    expect(mockedDb.receipt.update).toHaveBeenCalledWith({
      where: { id: "rcp_1" },
      data: { url: "https://cdn.test/RCP-1001.pdf" },
    });
    expect(result.url).toBe("https://cdn.test/RCP-1001.pdf");
  });

  it("still returns the created receipt if PDF generation or upload fails", async () => {
    const { generateReceiptPdf } = await import("@/backend/services/pdf");
    vi.mocked(generateReceiptPdf).mockRejectedValueOnce(new Error("PDF generation timed out"));

    const result = await receiptService.create({
      businessId: "biz_1", name: "Ada", currency: "NGN",
      subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 5000, notes: "gele",
    });

    expect(txMock.receipt.create).toHaveBeenCalled();
    expect(result.id).toBe("rcp_1");
    expect(result.receiptNumber).toBe("RCP-1001");
  });

  it("links the receipt to the resolved customer", async () => {
    await receiptService.create({
      businessId: "biz_1", name: "Ada", phone: "08035550142", currency: "NGN",
      subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 5000,
    });

    expect(mockedCustomer.resolve).toHaveBeenCalledWith(txMock, {
      businessId: "biz_1",
      name: "Ada",
      phone: "08035550142",
      email: undefined,
    });
    expect(txMock.receipt.create.mock.calls[0]![0].data.customerId).toBe("cus_1");
  });

  it("uses an explicit customerId owned by the business", async () => {
    await receiptService.create({
      businessId: "biz_1", name: "Ada", customerId: "cus_2", currency: "NGN",
      subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 5000,
    });

    expect(mockedCustomer.ownedBy).toHaveBeenCalledWith(txMock, "biz_1", "cus_2");
    expect(mockedCustomer.resolve).not.toHaveBeenCalled();
    expect(txMock.receipt.create.mock.calls[0]![0].data.customerId).toBe("cus_2");
  });

  it("rejects a customerId from another business", async () => {
    mockedCustomer.ownedBy.mockRejectedValue(
      new BadRequestException("Customer not found for this business"),
    );

    await expect(
      receiptService.create({
        businessId: "biz_1", name: "Ada", customerId: "cus_other", currency: "NGN",
        subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 5000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(txMock.receipt.create).not.toHaveBeenCalled();
  });

  describe("sales of products", () => {
    const PRODUCT_LINE = {
      productOptionId: "ckopt00000000000000000001",
      quantity: 2,
      unitPrice: 45000,
      total: 90000,
    };
    const SALE_INPUT = {
      businessId: "biz_1", name: "Tolu", phone: "08035550142", currency: "NGN",
      subtotal: 90000, taxAmount: 0, discount: 0, total: 90000, amountPaid: 90000,
    };

    beforeEach(() => {
      txMock.productOption = {
        findMany: vi.fn().mockResolvedValue([
          { id: "ckopt00000000000000000001", name: '20"', product: { name: "Frontal wig" } },
        ]),
      };
      createFromReceipt.mockResolvedValue({ id: "ord_1" } as never);
    });

    it("creates the order inside the receipt's transaction, as a pickup by default", async () => {
      await receiptService.create({ ...SALE_INPUT, lines: [PRODUCT_LINE] });

      expect(createFromReceipt).toHaveBeenCalledTimes(1);
      const [client, receipt, sale] = createFromReceipt.mock.calls[0]!;
      expect(client).toBe(txMock);
      expect(receipt).toMatchObject({
        id: "rcp_1",
        businessId: "biz_1",
        customerId: "cus_1",
        currency: "NGN",
        amountPaid: 5000,
        paymentMethod: null,
        lines: [
          expect.objectContaining({
            productOptionId: "ckopt00000000000000000001",
            name: 'Frontal wig — 20"',
            quantity: 2,
          }),
        ],
      });
      expect(sale).toEqual({ fulfilment: "PICKUP" });
    });

    it("passes the delivery choice through", async () => {
      await receiptService.create({
        ...SALE_INPUT,
        lines: [PRODUCT_LINE],
        sale: { fulfilment: "DELIVERY", deliveryAddress: "12 Admiralty Way" },
      });

      expect(createFromReceipt.mock.calls[0]![2]).toEqual({
        fulfilment: "DELIVERY",
        deliveryAddress: "12 Admiralty Way",
      });
    });

    it("creates no order for a receipt made for an existing payment", async () => {
      txMock.payment.findFirst.mockResolvedValue({
        id: "pay_1",
        receipt: null,
        invoice: null,
      });

      await receiptService.create({
        ...SALE_INPUT,
        paymentId: "pay_1",
        lines: [PRODUCT_LINE],
      });

      expect(createFromReceipt).not.toHaveBeenCalled();
    });

    it("creates no order for a receipt with only service lines", async () => {
      createFromReceipt.mockRestore();
      createFromReceipt = vi.spyOn(orderService, "createFromReceipt");
      txMock.service.findMany.mockResolvedValue([{ id: "ckser00000000000000000001", name: "Wig install" }]);

      await receiptService.create({
        ...SALE_INPUT,
        lines: [
          { serviceId: "ckser00000000000000000001", quantity: 1, unitPrice: 15000, total: 15000 },
        ],
      });

      // The real service ran and found nothing to sell: no order, payment or stock write.
      expect(createFromReceipt).toHaveReturnedWith(expect.any(Promise));
      await expect(createFromReceipt.mock.results[0]!.value).resolves.toBeNull();
      expect(txMock.order).toBeUndefined();
    });
  });
});

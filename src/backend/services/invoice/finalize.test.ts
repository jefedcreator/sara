import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    invoice: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/backend/services/pdf", () => ({ generateInvoicePdf: vi.fn() }));
vi.mock("@/backend/services/cloudinary", () => ({ cloudinaryService: { uploadImage: vi.fn() } }));

import { cloudinaryService } from "@/backend/services/cloudinary";
import { generateInvoicePdf } from "@/backend/services/pdf";
import { db } from "@/server/db";
import { NotFoundException } from "@/utils/exceptions";
import { finalizeInvoice, invoiceInclude } from "./finalize";

const mockedDb = db as any;
const DOCUMENT = {
  id: "invoice_1", publicId: "customer_link", invoiceNumber: "INV-1010",
  currency: "NGN", subtotal: 90000, taxAmount: 0, discount: 0,
  total: 90000, amountPaid: 45000, notes: "Committed notes",
  status: "SENT", dueAt: null, sentAt: null, paidAt: null,
  clientName: "Ada", clientEmail: "ada@example.test", clientPhone: null,
  business: { id: "biz_1", name: "Committed Business", email: null, phone: null, city: null, state: null, country: null, logoUrl: null },
  lines: [{ name: "Frontal wig", description: "Custom fit", quantity: 2, unitPrice: 45000, total: 90000 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.invoice.findUnique.mockResolvedValue(DOCUMENT);
  mockedDb.invoice.update.mockResolvedValue(DOCUMENT);
  vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
  vi.mocked(cloudinaryService.uploadImage).mockResolvedValue({ secure_url: "https://cdn.test/INV-1010.pdf" } as never);
});

describe("finalizeInvoice", () => {
  it("reloads the committed document and uploads its PDF under a deterministic id", async () => {
    await finalizeInvoice("invoice_1");

    expect(mockedDb.invoice.findUnique).toHaveBeenCalledWith({ where: { id: "invoice_1" }, include: invoiceInclude });
    expect(generateInvoicePdf).toHaveBeenCalledWith(expect.objectContaining({
      invoiceNumber: "INV-1010",
      notes: "Committed notes",
      business: expect.objectContaining({ name: "Committed Business" }),
      items: [{ description: "Custom fit", quantity: 2, unitPrice: "45000", total: "90000" }],
    }));
    expect(cloudinaryService.uploadImage).toHaveBeenCalledWith(Buffer.from("pdf"), {
      filename: "INV-1010.pdf", folder: "sara/businesses/biz_1/invoices",
      mime_type: "application/pdf", public_id: "invoice_1", resource_type: "raw",
    });
    expect(mockedDb.invoice.update).toHaveBeenCalledWith({
      where: { id: "invoice_1" }, data: { url: "https://cdn.test/INV-1010.pdf" },
    });
    expect(mockedDb.invoice.create).not.toHaveBeenCalled();
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
  });

  it("leaves the document and its public link usable when generation fails", async () => {
    vi.mocked(generateInvoicePdf).mockRejectedValueOnce(new Error("renderer unavailable"));

    await expect(finalizeInvoice("invoice_1")).resolves.toBeUndefined();

    expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
    expect(mockedDb.invoice.update).not.toHaveBeenCalled();
    expect(mockedDb.invoice.create).not.toHaveBeenCalled();
  });

  it("treats upload failure as best effort without writing a URL", async () => {
    vi.mocked(cloudinaryService.uploadImage).mockRejectedValueOnce(new Error("upload unavailable"));

    await expect(finalizeInvoice("invoice_1")).resolves.toBeUndefined();

    expect(mockedDb.invoice.update).not.toHaveBeenCalled();
    expect(mockedDb.invoice.create).not.toHaveBeenCalled();
  });

  it("preserves database URL-write failures for the caller", async () => {
    mockedDb.invoice.update.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(finalizeInvoice("invoice_1")).rejects.toThrow("database unavailable");
  });

  it("does not render or create a missing document", async () => {
    mockedDb.invoice.findUnique.mockResolvedValueOnce(null);

    await expect(finalizeInvoice("missing")).rejects.toBeInstanceOf(NotFoundException);

    expect(generateInvoicePdf).not.toHaveBeenCalled();
    expect(mockedDb.invoice.create).not.toHaveBeenCalled();
  });
});

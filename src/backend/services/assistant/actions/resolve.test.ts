import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    business: { findFirst: vi.fn() },
    customer: { findFirst: vi.fn(), findMany: vi.fn() },
    invoice: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    receipt: { create: vi.fn() },
    order: { findFirst: vi.fn(), findUnique: vi.fn() },
    booking: { findFirst: vi.fn() },
    service: { findFirst: vi.fn() },
    product: { findFirst: vi.fn() },
    productOption: { findFirst: vi.fn(), findMany: vi.fn() },
    orderLine: { groupBy: vi.fn() },
    payment: { create: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});

vi.mock("@/backend/services/customer", () => ({
  customerService: { resolve: vi.fn(), ownedBy: vi.fn() },
  normalizeEmail: vi.fn((e: string | null) => e),
  normalizePhone: vi.fn((p: string | null) => p),
}));

import { db } from "@/server/db";
import { resolveDraft } from "./resolve";
import type { AssistantScope } from "../types";
import type { DraftRequest } from "./schemas";
import type { OwnerEvidence } from "./types";
import { Prisma } from "@prisma/client";

const mockedDb = db as any;
const scope: AssistantScope = { businessId: "biz_1", channel: "WEB", principalId: "user_1" };
const NOW = new Date("2026-11-04T10:00:00Z");
const BUSINESS = { id: "biz_1", currency: "NGN", name: "Acme Salon" };
const EVIDENCE: OwnerEvidence = {
  text: "Invoice Tolu for two frontal wigs at 45,000",
  recentOwnerTexts: [],
  selectedIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.business.findFirst.mockResolvedValue(BUSINESS);
});

describe("resolveDraft", () => {
  describe("create_invoice", () => {
    it("resolves a valid invoice with service lines", async () => {
      mockedDb.customer.findFirst.mockResolvedValue({
        id: "cus_1", name: "Tolu", phone: "+2348000000000", email: null, address: null,
      });
      mockedDb.customer.findMany.mockResolvedValue([]);
      mockedDb.service.findFirst.mockResolvedValue({
        id: "svc_1", name: "Frontal wig", price: new Prisma.Decimal(45000), description: "Wig installation",
      });

      const request: DraftRequest = {
        kind: "create_invoice",
        customer: { kind: "existing", id: "cus_1" },
        lines: [{ kind: "service", id: "svc_1", name: null, quantity: 2, priceOverride: null }],
        dueDate: null,
        notes: null,
      };

      const result = await resolveDraft(mockedDb, scope, request, {
        ...EVIDENCE, selectedIds: ["cus_1"],
      }, NOW);

      expect(result).not.toHaveProperty("question");
      expect(result).toHaveProperty("kind", "create_invoice");
      const action = result as { kind: string; payload: any; snapshot: any };
      expect(action.payload.totalMinor).toBe(9_000_000);
      expect(action.payload.lines).toHaveLength(1);
      expect(action.payload.lines[0].unitPriceMinor).toBe(4_500_000);
    });

    it("does not write any invoices or customers during resolution", async () => {
      mockedDb.customer.findFirst.mockResolvedValue({
        id: "cus_1", name: "Tolu", phone: null, email: null, address: null,
      });
      mockedDb.customer.findMany.mockResolvedValue([]);
      mockedDb.service.findFirst.mockResolvedValue({
        id: "svc_1", name: "Frontal wig", price: new Prisma.Decimal(45000), description: null,
      });

      const request: DraftRequest = {
        kind: "create_invoice",
        customer: { kind: "existing", id: "cus_1" },
        lines: [{ kind: "service", id: "svc_1", name: null, quantity: 1, priceOverride: null }],
        dueDate: null,
        notes: null,
      };

      await resolveDraft(mockedDb, scope, request, {
        ...EVIDENCE, selectedIds: ["cus_1"],
      }, NOW);

      expect(mockedDb.invoice.create).not.toHaveBeenCalled();
      expect(mockedDb.invoice.update).not.toHaveBeenCalled();
      expect(mockedDb.receipt.create).not.toHaveBeenCalled();
    });

    it("returns clarification for ambiguous customer", async () => {
      mockedDb.customer.findFirst.mockResolvedValue({
        id: "cus_1", name: "Tolu", phone: null, email: null, address: null,
      });
      mockedDb.customer.findMany.mockResolvedValue([
        { id: "cus_1", name: "Tolu Adekunle", phone: "+234800", email: null },
        { id: "cus_2", name: "Tolu Bakare", phone: "+234801", email: null },
      ]);

      const request: DraftRequest = {
        kind: "create_invoice",
        customer: { kind: "existing", id: "cus_1" },
        lines: [{ kind: "service", id: "svc_1", name: null, quantity: 1, priceOverride: null }],
        dueDate: null,
        notes: null,
      };

      const result = await resolveDraft(mockedDb, scope, request, EVIDENCE, NOW);
      expect(result).toHaveProperty("question");
      expect((result as any).choices.length).toBeGreaterThan(1);
    });

    it("rejects custom lines without price evidence", async () => {
      mockedDb.customer.findFirst.mockResolvedValue({
        id: "cus_1", name: "Tolu", phone: null, email: null, address: null,
      });
      mockedDb.customer.findMany.mockResolvedValue([]);

      const request: DraftRequest = {
        kind: "create_invoice",
        customer: { kind: "existing", id: "cus_1" },
        lines: [{ kind: "custom", id: null, name: "Special wig", quantity: 1, priceOverride: null }],
        dueDate: null,
        notes: null,
      };

      await expect(
        resolveDraft(mockedDb, scope, request, { ...EVIDENCE, selectedIds: ["cus_1"] }, NOW),
      ).rejects.toThrow("price");
    });

    it("rejects foreign customer", async () => {
      mockedDb.customer.findFirst.mockResolvedValue(null);

      const request: DraftRequest = {
        kind: "create_invoice",
        customer: { kind: "existing", id: "foreign_cus" },
        lines: [{ kind: "service", id: "svc_1", name: null, quantity: 1, priceOverride: null }],
        dueDate: null,
        notes: null,
      };

      await expect(
        resolveDraft(mockedDb, scope, request, { ...EVIDENCE, selectedIds: ["foreign_cus"] }, NOW),
      ).rejects.toThrow("Customer not found");
    });
  });

  describe("record_invoice_payment", () => {
    it("validates against outstanding balance", async () => {
      mockedDb.invoice.findFirst.mockResolvedValue({
        id: "inv_1", slug: "inv-1", status: "PARTIALLY_PAID",
        total: new Prisma.Decimal(90000), amountPaid: new Prisma.Decimal(60000),
        clientName: "Tolu", currency: "NGN", invoiceNumber: "INV-1001",
        updatedAt: NOW,
      });

      const request: DraftRequest = {
        kind: "record_invoice_payment",
        invoiceId: "inv_1",
        amount: { quote: "45,000", amountMinor: 4_500_000 },
        method: "CASH",
        createReceipt: false,
      };

      await expect(
        resolveDraft(mockedDb, scope, request, {
          text: "Record a payment of 45,000 on INV-1001",
          recentOwnerTexts: [], selectedIds: [],
        }, NOW),
      ).rejects.toThrow("outstanding");
    });

    it("rejects payment on PAID invoice", async () => {
      mockedDb.invoice.findFirst.mockResolvedValue({
        id: "inv_1", status: "PAID",
        total: new Prisma.Decimal(90000), amountPaid: new Prisma.Decimal(90000),
        clientName: "Tolu", currency: "NGN", invoiceNumber: "INV-1001",
        updatedAt: NOW,
      });

      const request: DraftRequest = {
        kind: "record_invoice_payment",
        invoiceId: "inv_1",
        amount: { quote: "10,000", amountMinor: 1_000_000 },
        method: "CASH",
        createReceipt: false,
      };

      await expect(
        resolveDraft(mockedDb, scope, request, {
          text: "Pay 10,000 on INV-1001",
          recentOwnerTexts: [], selectedIds: [],
        }, NOW),
      ).rejects.toThrow("cannot record");
    });
  });

  describe("adjust_stock", () => {
    it("resolves a stock adjustment with before/after", async () => {
      mockedDb.productOption.findFirst.mockResolvedValue({
        id: "opt_1", name: "Red", stock: 10, updatedAt: NOW,
        product: { id: "prod_1", name: "T-Shirt", tracksStock: true },
      });

      const request: DraftRequest = {
        kind: "adjust_stock",
        optionId: "opt_1",
        mode: "add",
        quantity: 5,
      };

      const result = await resolveDraft(mockedDb, scope, request, EVIDENCE, NOW);
      expect(result).toHaveProperty("kind", "adjust_stock");
      const action = result as { payload: any };
      expect(action.payload.previousStock).toBe(10);
      expect(action.payload.newStock).toBe(15);
    });

    it("rejects removing more than available", async () => {
      mockedDb.productOption.findFirst.mockResolvedValue({
        id: "opt_1", name: "Red", stock: 3, updatedAt: NOW,
        product: { id: "prod_1", name: "T-Shirt", tracksStock: true },
      });

      const request: DraftRequest = {
        kind: "adjust_stock",
        optionId: "opt_1",
        mode: "remove",
        quantity: 5,
      };

      await expect(
        resolveDraft(mockedDb, scope, request, EVIDENCE, NOW),
      ).rejects.toThrow("Cannot remove more");
    });

    it("rejects stock adjustment on untracked product", async () => {
      mockedDb.productOption.findFirst.mockResolvedValue({
        id: "opt_1", name: "Red", stock: 0, updatedAt: NOW,
        product: { id: "prod_1", name: "T-Shirt", tracksStock: false },
      });

      const request: DraftRequest = {
        kind: "adjust_stock",
        optionId: "opt_1",
        mode: "set",
        quantity: 10,
      };

      await expect(
        resolveDraft(mockedDb, scope, request, EVIDENCE, NOW),
      ).rejects.toThrow("does not track stock");
    });
  });

  describe("create_customer", () => {
    it("returns clarification when existing customer matches", async () => {
      mockedDb.customer.findMany.mockResolvedValue([
        { id: "cus_1", name: "Tolu Adekunle", phone: "+234800", email: null },
      ]);

      const request: DraftRequest = {
        kind: "create_customer",
        name: "Tolu Adekunle",
        phone: "+234800",
        email: null,
        address: null,
        notes: null,
      };

      const result = await resolveDraft(mockedDb, scope, request, EVIDENCE, NOW);
      expect(result).toHaveProperty("question");
      expect((result as any).choices.length).toBeGreaterThanOrEqual(2);
    });

    it("resolves when __new__ is selected", async () => {
      mockedDb.customer.findMany.mockResolvedValue([
        { id: "cus_1", name: "Tolu", phone: "+234800", email: null },
      ]);

      const request: DraftRequest = {
        kind: "create_customer",
        name: "Tolu",
        phone: "+234800",
        email: null,
        address: null,
        notes: null,
      };

      const result = await resolveDraft(mockedDb, scope, request, {
        ...EVIDENCE, selectedIds: ["__new__"],
      }, NOW);
      expect(result).toHaveProperty("kind", "create_customer");
    });
  });

  describe("void_invoice", () => {
    it("rejects voiding a paid invoice", async () => {
      mockedDb.invoice.findFirst.mockResolvedValue({
        id: "inv_1", status: "PAID", invoiceNumber: "INV-1001", clientName: "Tolu", updatedAt: NOW,
      });

      const request: DraftRequest = {
        kind: "void_invoice",
        invoiceId: "inv_1",
        cancelOrder: false,
      };

      await expect(
        resolveDraft(mockedDb, scope, request, EVIDENCE, NOW),
      ).rejects.toThrow("paid invoice cannot be voided");
    });
  });

  describe("update_customer", () => {
    it("resolves a valid customer update", async () => {
      mockedDb.customer.findFirst.mockResolvedValue({
        id: "cus_1", name: "Tolu", phone: "+234800", email: null, address: null, updatedAt: NOW,
      });

      const request: DraftRequest = {
        kind: "update_customer",
        customerId: "cus_1",
        name: "Tolu Updated",
        phone: null,
        email: null,
        address: null,
        notes: null,
        fields: ["name"],
      };

      const result = await resolveDraft(mockedDb, scope, request, EVIDENCE, NOW);
      expect(result).toHaveProperty("kind", "update_customer");
      const action = result as { payload: any };
      expect(action.payload.name).toBe("Tolu Updated");
    });

    it("rejects unknown customer fields", async () => {
      mockedDb.customer.findFirst.mockResolvedValue({
        id: "cus_1", name: "Tolu", phone: null, email: null, address: null, updatedAt: NOW,
      });

      const request: DraftRequest = {
        kind: "update_customer",
        customerId: "cus_1",
        name: null,
        phone: null,
        email: null,
        address: null,
        notes: null,
        fields: ["bankAccount"],
      };

      await expect(
        resolveDraft(mockedDb, scope, request, EVIDENCE, NOW),
      ).rejects.toThrow("Unknown customer field");
    });
  });

  describe("create_product", () => {
    it("rejects duplicate product name", async () => {
      mockedDb.product.findFirst.mockResolvedValue({ id: "prod_1", name: "Shea Butter" });

      const request: DraftRequest = {
        kind: "create_product",
        name: "Shea Butter",
        description: null,
        price: { quote: "5,000", amountMinor: 500_000 },
        tracksStock: true,
        options: [{ name: "Default", price: null, stock: 10 }],
      };

      await expect(
        resolveDraft(mockedDb, scope, request, {
          text: "Create Shea Butter at 5,000",
          recentOwnerTexts: [], selectedIds: [],
        }, NOW),
      ).rejects.toThrow("already exists");
    });
  });
});

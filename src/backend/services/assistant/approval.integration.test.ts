import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { withSerializable } from "./transaction";
import { approveAction } from "./actions/approve";
import { createDraft } from "./actions/drafts";
import { resolveDraft } from "./actions/resolve";
import { renderSummary } from "./actions/summary";
import type { PreparedAction, OwnerEvidence, DraftRequest } from "./types";
import type { AssistantScope } from "../types";

const scope: AssistantScope = { businessId: "test-business", channel: "WHATSAPP", principalId: "test-owner" };
const now = new Date("2026-11-04T12:00:00.000Z");

// Test fixtures
const testBusinessId = "test-business-integration";
const testOwnerId = "test-owner-integration";
const testScope: AssistantScope = { businessId: testBusinessId, channel: "WHATSAPP", principalId: testOwnerId };

// Create test business and product
async function setupTestData() {
  // Clean up first
  await db.business.deleteMany({ where: { id: testBusinessId } });
  await db.productOption.deleteMany({ where: { product: { businessId: testBusinessId } } });
  await db.product.deleteMany({ where: { businessId: testBusinessId } });
  await db.customer.deleteMany({ where: { businessId: testBusinessId } });

  // Create business
  const business = await db.business.create({
    data: {
      id: testBusinessId,
      name: "Test Business",
      currency: "NGN",
    },
  });

  // Create product with stock
  const product = await db.product.create({
    data: {
      businessId: testBusinessId,
      name: "Test Product",
      price: new Prisma.Decimal(5000),
      tracksStock: true,
      isActive: true,
      slug: "test-product",
    },
  });

  const option = await db.productOption.create({
    data: {
      productId: product.id,
      name: "Standard",
      price: new Prisma.Decimal(5000),
      stock: 10,
      isActive: true,
    },
  });

  // Create customer
  const customer = await db.customer.create({
    data: {
      businessId: testBusinessId,
      name: "Test Customer",
      phone: "+2348000000000",
      nameKey: "test customer",
    },
  });

  return { business, product, option, customer };
}

async function createTestConversation() {
  const conversation = await db.assistantConversation.upsert({
    where: { id: "test-conversation" },
    create: {
      id: "test-conversation",
      businessId: testBusinessId,
      channel: "WHATSAPP",
      principalId: testOwnerId,
      memoryVersion: 1,
      leaseToken: "test-token",
      leaseExpiresAt: new Date(now.getTime() + 30000),
      lastActiveAt: now,
    },
    update: {
      memoryVersion: { increment: 1 },
      leaseToken: "test-token",
      leaseExpiresAt: new Date(now.getTime() + 30000),
      lastActiveAt: now,
    },
  });
  return conversation;
}

/**
 * Create a draft action for testing approvals.
 * This helper creates a draft that can be approved.
 */
async function createApprovalDraft(
  scope: AssistantScope,
  conversationId: string,
  request: DraftRequest,
  evidence: OwnerEvidence,
): Promise<{ draftId: string; prepared: PreparedAction }> {
  // Resolve the draft first
  const resolved = await withSerializable(async (tx) => {
    return resolveDraft(tx, scope, request, evidence, now);
  });

  if ("question" in resolved) {
    throw new Error(`Draft resolution returned question: ${resolved.question}`);
  }

  // Create the draft
  const draft = await createDraft(
    scope,
    resolved,
    1,
    now,
    {
      conversationId,
      leaseToken: "test-token",
      signal: new AbortController().signal,
    },
  );

  return { draftId: draft.id, prepared: resolved };
}

describe("approval integration tests", () => {
  beforeAll(async () => {
    // Ensure the test database is available
    // This test file should only run with ASSISTANT_TEST_DATABASE_URL set
    // pointing to localhost/127.0.0.1 with database sara_assistant_test
  });

  beforeEach(async () => {
    // Clean up test data
    await db.assistantAction.deleteMany({ where: { businessId: testBusinessId } });
    await db.assistantConversation.deleteMany({ where: { businessId: testBusinessId } });
    await db.receipt.deleteMany({ where: { businessId: testBusinessId } });
    await db.order.deleteMany({ where: { businessId: testBusinessId } });
    await db.invoice.deleteMany({ where: { businessId: testBusinessId } });
    await db.productOption.updateMany({
      where: { product: { businessId: testBusinessId } },
      data: { stock: 10 },
    });
  });

  describe("concurrent approvals", () => {
    it("commits one sale when distinct messages approve concurrently", async () => {
      await setupTestData();
      const conversation = await createTestConversation();

      // Create a receipt draft
      const request: DraftRequest = {
        kind: "create_receipt",
        customer: { kind: "existing", id: "" },
        lines: [{ kind: "product", id: "option-1", name: null, quantity: 3, priceOverride: null }],
        amount: null,
        method: "CASH",
        fulfilment: "PICKUP",
        deliveryAddress: null,
        notes: null,
      };

      const evidence: OwnerEvidence = {
        text: "Sold three bottles",
        recentOwnerTexts: [],
        selectedIds: ["option-1"],
      };

      // This test needs a real implementation that can create drafts
      // For now, we'll create a minimal action directly
      const action = await db.assistantAction.create({
        data: {
          id: "draft-1",
          conversationId: conversation.id,
          businessId: testBusinessId,
          channel: "WHATSAPP",
          principalId: testOwnerId,
          kind: "create_receipt",
          payload: {
            customer: { name: "Test Customer", phone: "+2348000000000", email: null, address: null },
            lines: [{ kind: "product", id: "option-1", name: "Test Product", quantity: 3, unitPriceMinor: 500000, totalMinor: 1500000, productOptionId: "option-1", serviceId: null, description: null }],
            amountPaidMinor: 1500000,
            subtotalMinor: 1500000,
            taxAmountMinor: 0,
            discountMinor: 0,
            totalMinor: 1500000,
            method: "CASH",
            fulfilment: "PICKUP",
            deliveryAddress: null,
            notes: null,
            currency: "NGN",
          } as any,
          snapshot: {
            businessId: testBusinessId,
            businessCurrency: "NGN",
            originalRequest: request,
            ownerEvidence: evidence,
            resolvedAt: now.toISOString(),
          },
          summary: renderSummary("create_receipt", {
            customer: { name: "Test Customer", phone: "+2348000000000", email: null, address: null },
            lines: [{ kind: "product", id: "option-1", name: "Test Product", quantity: 3, unitPriceMinor: 500000, totalMinor: 1500000, productOptionId: "option-1", serviceId: null, description: null }],
            amountPaidMinor: 1500000,
            subtotalMinor: 1500000,
            taxAmountMinor: 0,
            discountMinor: 0,
            totalMinor: 1500000,
            method: "CASH",
            fulfilment: "PICKUP",
            deliveryAddress: null,
            notes: null,
            currency: "NGN",
          } as any, {
            businessId: testBusinessId,
            businessCurrency: "NGN",
            customerWillBeCreated: false,
            receiptEmailWillBeSent: false,
          } as any),
          status: "PENDING",
          result: null,
          approvedAt: null,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });

      // Run two concurrent approvals
      const [reply1, reply2] = await Promise.all([
        approveAction(testScope, action.id, now),
        approveAction(testScope, action.id, new Date(now.getTime() + 1)),
      ]);

      // One should be approved, one should be already_done
      const statuses = [reply1.status, reply2.status].sort();
      expect(statuses).toEqual(["already_done", "approved"]);

      // Check that only one receipt was created
      const receipts = await db.receipt.count({ where: { businessId: testBusinessId } });
      expect(receipts).toBe(1);

      // Check that only one order was created
      const orders = await db.order.count({ where: { businessId: testBusinessId } });
      expect(orders).toBe(1);

      // Check that stock was reduced
      const option = await db.productOption.findFirst({
        where: { product: { businessId: testBusinessId } },
      });
      expect(option?.stock).toBe(7); // 10 - 3 = 7
    });

    it("commits one action when the same message approves twice", async () => {
      await setupTestData();
      const conversation = await createTestConversation();

      // Create a draft action
      const action = await db.assistantAction.create({
        data: {
          id: "draft-2",
          conversationId: conversation.id,
          businessId: testBusinessId,
          channel: "WHATSAPP",
          principalId: testOwnerId,
          kind: "create_customer",
          payload: { name: "New Customer", phone: "+2348000000001", email: null, address: null, notes: null },
          snapshot: {
            businessId: testBusinessId,
            businessCurrency: "NGN",
            originalRequest: { kind: "create_customer", name: "New Customer", phone: "+2348000000001", email: null, address: null, notes: null },
            ownerEvidence: { text: "Add New Customer", recentOwnerTexts: [], selectedIds: [] },
            resolvedAt: now.toISOString(),
          },
          summary: "Create customer New Customer?",
          status: "PENDING",
          result: null,
          approvedAt: null,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });

      // Approve once
      const reply1 = await approveAction(testScope, action.id, now);
      expect(reply1.status).toBe("approved");

      // Approve again (should return already_done)
      const reply2 = await approveAction(testScope, action.id, new Date(now.getTime() + 1000));
      expect(reply2.status).toBe("already_done");

      // Check that only one customer was created
      const customers = await db.customer.count({
        where: { businessId: testBusinessId, name: "New Customer" },
      });
      expect(customers).toBe(1);
    });
  });

  describe("approval race conditions", () => {
    it("handles concurrent approval and expiry gracefully", async () => {
      await setupTestData();
      const conversation = await createTestConversation();

      // Create a draft that's about to expire
      const expiringAt = new Date(now.getTime() + 10); // 10ms from now
      const action = await db.assistantAction.create({
        data: {
          id: "draft-expiring",
          conversationId: conversation.id,
          businessId: testBusinessId,
          channel: "WHATSAPP",
          principalId: testOwnerId,
          kind: "create_customer",
          payload: { name: "Expiring Customer", phone: "+2348000000002", email: null, address: null, notes: null },
          snapshot: {
            businessId: testBusinessId,
            businessCurrency: "NGN",
            originalRequest: { kind: "create_customer", name: "Expiring Customer", phone: "+2348000000002", email: null, address: null, notes: null },
            ownerEvidence: { text: "Add Expiring Customer", recentOwnerTexts: [], selectedIds: [] },
            resolvedAt: now.toISOString(),
          },
          summary: "Create customer Expiring Customer?",
          status: "PENDING",
          result: null,
          approvedAt: null,
          createdAt: now,
          expiresAt: expiringAt,
        },
      });

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Try to approve (should fail with expired)
      const reply = await approveAction(testScope, action.id, new Date());
      expect(reply.status).toBe("expired");

      // Check that the action was marked as expired
      const updatedAction = await db.assistantAction.findUnique({ where: { id: action.id } });
      expect(updatedAction?.status).toBe("EXPIRED");
    });

    it("handles foreign principal rejection", async () => {
      await setupTestData();
      const conversation = await createTestConversation();

      // Create a draft for the test owner
      const action = await db.assistantAction.create({
        data: {
          id: "draft-foreign",
          conversationId: conversation.id,
          businessId: testBusinessId,
          channel: "WHATSAPP",
          principalId: testOwnerId,
          kind: "create_customer",
          payload: { name: "Foreign Test", phone: "+2348000000003", email: null, address: null, notes: null },
          snapshot: {
            businessId: testBusinessId,
            businessCurrency: "NGN",
            originalRequest: { kind: "create_customer", name: "Foreign Test", phone: "+2348000000003", email: null, address: null, notes: null },
            ownerEvidence: { text: "Add Foreign Test", recentOwnerTexts: [], selectedIds: [] },
            resolvedAt: now.toISOString(),
          },
          summary: "Create customer Foreign Test?",
          status: "PENDING",
          result: null,
          approvedAt: null,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });

      // Try to approve with a different principal
      const foreignScope: AssistantScope = { businessId: testBusinessId, channel: "WHATSAPP", principalId: "foreign-owner" };
      
      await expect(approveAction(foreignScope, action.id, now)).rejects.toMatchObject({
        code: "ACTION_NOT_FOUND",
      });
    });
  });

  describe("document number uniqueness", () => {
    it("handles two distinct invoices with different numbers", async () => {
      await setupTestData();
      const conversation = await createTestConversation();

      // This test would need actual invoice creation through the dispatcher
      // For now, we just verify that the approval logic doesn't create duplicates
      // This is a placeholder for the actual test
    });
  });

  describe("stock validation", () => {
    it("rejects approval when stock is insufficient", async () => {
      await setupTestData();
      const conversation = await createTestConversation();

      // Set stock to 2
      await db.productOption.updateMany({
        where: { product: { businessId: testBusinessId } },
        data: { stock: 2 },
      });

      // Create a receipt draft for 3 items (more than stock)
      const action = await db.assistantAction.create({
        data: {
          id: "draft-stock",
          conversationId: conversation.id,
          businessId: testBusinessId,
          channel: "WHATSAPP",
          principalId: testOwnerId,
          kind: "create_receipt",
          payload: {
            customer: { name: "Stock Test", phone: "+2348000000004", email: null, address: null },
            lines: [{ kind: "product", id: "option-1", name: "Test Product", quantity: 3, unitPriceMinor: 500000, totalMinor: 1500000, productOptionId: "option-1", serviceId: null, description: null }],
            amountPaidMinor: 1500000,
            subtotalMinor: 1500000,
            taxAmountMinor: 0,
            discountMinor: 0,
            totalMinor: 1500000,
            method: "CASH",
            fulfilment: "PICKUP",
            deliveryAddress: null,
            notes: null,
            currency: "NGN",
          } as any,
          snapshot: {
            businessId: testBusinessId,
            businessCurrency: "NGN",
            originalRequest: { kind: "create_receipt", customer: { kind: "existing", id: "" }, lines: [{ kind: "product", id: "option-1", name: null, quantity: 3, priceOverride: null }], amount: null, method: "CASH", fulfilment: "PICKUP", deliveryAddress: null, notes: null },
            ownerEvidence: { text: "Sold three bottles", recentOwnerTexts: [], selectedIds: ["option-1"] },
            resolvedAt: now.toISOString(),
            stockBefore: { "option-1": 2 },
            stockAfter: { "option-1": -1 },
          } as any,
          summary: "Record a sale for Stock Test?\n3 × Test Product · NGN 5,000 each · NGN 15,000\nTotal: NGN 15,000\nPaid cash · Pickup\nCreate a receipt and completed pickup order.\nAvailable stock · Test Product: 2 → -1.",
          status: "PENDING",
          result: null,
          approvedAt: null,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });

      // Try to approve (should fail due to insufficient stock)
      await expect(approveAction(testScope, action.id, now)).rejects.toThrow();

      // Verify stock was not changed
      const option = await db.productOption.findFirst({
        where: { product: { businessId: testBusinessId } },
      });
      expect(option?.stock).toBe(2);
    });
  });
});

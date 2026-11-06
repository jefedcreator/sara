import { randomUUID } from "node:crypto";
import type * as ExecuteModule from "./actions/execute";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Retain the real dispatcher and every transaction/domain service. Only the
// post-commit remote delivery boundary is replaced; these tests make no calls
// to PDF storage, email, calendar or OpenAI.
vi.mock("./actions/execute", async (original) => ({
  ...await original<typeof ExecuteModule>(),
  finalizeEffects: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/server/db";
import { chatSessionService } from "@/backend/services/messaging/session";
import { approveAction } from "./actions/approve";
import { createDraft } from "./actions/drafts";
import { finalizeEffects } from "./actions/execute";
import { resolveDraft } from "./actions/resolve";
import type { DraftRequest } from "./actions/schemas";
import type { OwnerEvidence } from "./actions/types";
import { lagosDay } from "./clock";
import { controlTurn } from "./store";
import { reserveUsage } from "./usage";
import { withSerializable } from "./transaction";
import type { AssistantScope } from "./types";

let now: Date;
const fixtureOwners: string[] = [];

async function conversation(scope: AssistantScope) {
  return db.assistantConversation.upsert({
    where: { businessId_channel_principalId: scope },
    create: { ...scope, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000), lastActiveAt: now },
    update: { leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000), lastActiveAt: now },
  });
}

async function draft(scope: AssistantScope, request: DraftRequest, text: string) {
  const active = await conversation(scope);
  const evidence: OwnerEvidence = { text, recentOwnerTexts: [], selectedIds: [] };
  const prepared = await withSerializable((tx) => resolveDraft(tx, scope, request, evidence, now));
  if ("question" in prepared) throw new Error(`Unexpected fixture clarification: ${prepared.question}`);
  return createDraft(scope, prepared, active.memoryVersion, now, {
    conversationId: active.id, leaseToken: active.leaseToken!,
  });
}

async function setupFixture() {
  const token = randomUUID();
  const owner = await db.user.create({ data: { name: "Assistant integration owner" } });
  fixtureOwners.push(owner.id);
  const business = await db.business.create({ data: {
    ownerId: owner.id, name: `Assistant test ${token}`, slug: `assistant-test-${token}`,
    currency: "NGN", sells: "PRODUCTS", offersPickup: true,
  } });
  const customer = await db.customer.create({ data: { businessId: business.id, name: "Amaka", nameKey: "amaka", phone: "+2348035550101" } });
  const product = await db.product.create({ data: {
    businessId: business.id, name: "Shea butter", slug: `shea-${token}`, price: 5000,
    tracksStock: true, options: { create: [{ name: "", stock: 10, position: 0 }] },
  }, include: { options: true } });
  const option = product.options[0]!;
  const identity = await db.chatIdentity.create({ data: { businessId: business.id, channel: "WHATSAPP", externalId: `assistant-${token}` } });
  const scope: AssistantScope = { businessId: business.id, channel: "WHATSAPP", principalId: identity.id };
  const request: DraftRequest = {
    kind: "create_receipt", customer: { kind: "existing", id: customer.id },
    lines: [{ kind: "product", id: option.id, name: null, quantity: 3, priceOverride: null }],
    amount: null, method: "CASH", fulfilment: "PICKUP", deliveryAddress: null, notes: null,
  };
  const sale = await draft(scope, request, "Sold three Shea butter to Amaka, paid cash, pickup");
  return { owner, business, customer, product, option, identity, scope, request, sale };
}

let fixture: Awaited<ReturnType<typeof setupFixture>>;

async function assertNoSale() {
  const { business, option } = fixture;
  expect(await db.receipt.count({ where: { businessId: business.id } })).toBe(0);
  expect(await db.order.count({ where: { businessId: business.id } })).toBe(0);
  expect(await db.payment.count({ where: { businessId: business.id } })).toBe(0);
  expect((await db.productOption.findUniqueOrThrow({ where: { id: option.id } })).stock).toBe(10);
}

beforeEach(async () => {
  now = new Date();
  vi.mocked(finalizeEffects).mockReset().mockResolvedValue(undefined);
  fixture = await setupFixture();
});
afterEach(async () => {
  // Delete only this run's explicit owners. All fixture descendants cascade.
  for (const ownerId of fixtureOwners.splice(0)) await db.user.deleteMany({ where: { id: ownerId } });
});
afterAll(async () => db.$disconnect());

describe("PostgreSQL assistant approval guarantees", () => {
  it("commits one sale when distinct messages approve concurrently", async () => {
    const { scope, sale, business, option } = fixture;
    const replies = await Promise.all([approveAction(scope, sale.id, now), approveAction(scope, sale.id, now)]);
    expect(replies.map((reply) => reply.status).sort()).toEqual(["already_done", "approved"]);
    expect(replies[0].result).toEqual(replies[1].result);
    expect(await db.receipt.count({ where: { businessId: business.id } })).toBe(1);
    expect(await db.order.count({ where: { businessId: business.id } })).toBe(1);
    expect(await db.payment.count({ where: { businessId: business.id } })).toBe(1);
    expect((await db.productOption.findUniqueOrThrow({ where: { id: option.id } })).stock).toBe(7);
    expect(finalizeEffects).toHaveBeenCalledTimes(1);
    expect(await db.assistantUsage.count({ where: { businessId: business.id, mode: "APPROVAL" } })).toBe(1);
    expect(await db.assistantDailyUsage.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("replays a completed approval without repeating domain writes or effects", async () => {
    const first = await approveAction(fixture.scope, fixture.sale.id, now);
    const replay = await approveAction(fixture.scope, fixture.sale.id, now);
    expect(replay.status).toBe("already_done");
    expect(replay.result).toEqual(first.result);
    expect(await db.receipt.count({ where: { businessId: fixture.business.id } })).toBe(1);
    expect(finalizeEffects).toHaveBeenCalledTimes(1);
  });

  it("replays a cancellation without cancelling a newer preview", async () => {
    const { scope, request, sale } = fixture;
    const cancelled = await controlTurn(scope, "cancel-request", "cancel");
    expect((await db.assistantAction.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe("CANCELLED");
    const replacement = await draft(scope, request, "Sold three Shea butter to Amaka, paid cash, pickup");
    const replay = await controlTurn(scope, "cancel-request", "cancel");
    expect(replay).toEqual(cancelled);
    expect((await db.assistantAction.findUniqueOrThrow({ where: { id: replacement.id } })).status).toBe("PENDING");
    await assertNoSale();
  });

  it("serializes a replacement preview racing approval of the previous preview", async () => {
    const { scope, request, sale, business, option } = fixture;
    const [approval, replacement] = await Promise.all([
      approveAction(scope, sale.id, now),
      draft(scope, { ...request, lines: request.lines.map((line) => ({ ...line, quantity: 2 })) },
        "Sold two Shea butter to Amaka, paid cash, pickup"),
    ]);
    expect(["approved", "expired"]).toContain(approval.status);
    const previous = await db.assistantAction.findUniqueOrThrow({ where: { id: sale.id } });
    expect(previous.status).toBe(approval.status === "approved" ? "APPROVED" : "REPLACED");
    const pending = await db.assistantAction.findMany({ where: { businessId: business.id, status: "PENDING" } });
    expect(pending.map((action) => action.id)).toEqual([replacement.id]);
    expect(await db.receipt.count({ where: { businessId: business.id } })).toBe(approval.status === "approved" ? 1 : 0);
    expect((await db.productOption.findUniqueOrThrow({ where: { id: option.id } })).stock).toBe(approval.status === "approved" ? 7 : 10);
  });

  it("allocates distinct numbers when two conversations create invoices concurrently", async () => {
    const { scope, customer, option, business } = fixture;
    const request: DraftRequest = { kind: "create_invoice", customer: { kind: "existing", id: customer.id },
      lines: [{ kind: "product", id: option.id, name: null, quantity: 1, priceOverride: null }], dueDate: null, notes: null };
    const otherScope: AssistantScope = { ...scope, channel: "WEB", principalId: fixture.owner.id };
    const [one, two] = await Promise.all([
      draft(scope, request, "Invoice Amaka for one Shea butter"),
      draft(otherScope, request, "Invoice Amaka for one Shea butter"),
    ]);
    const replies = await Promise.all([approveAction(scope, one.id, now), approveAction(otherScope, two.id, now)]);
    expect(replies.map((reply) => reply.status)).toEqual(["approved", "approved"]);
    const invoices = await db.invoice.findMany({ where: { businessId: business.id }, orderBy: { invoiceNumber: "asc" } });
    expect(invoices.map((invoice) => invoice.invoiceNumber)).toEqual(["INV-1001", "INV-1002"]);
    expect((await db.productOption.findUniqueOrThrow({ where: { id: option.id } })).stock).toBe(10);
  });

  it("rolls back inserted receipt, order, payment, customer, stock and claim on a database failure", async () => {
    const { scope, request, business } = fixture;
    const newCustomerSale = await draft(scope, { ...request, customer: { kind: "new", name: "Zainab", phone: "+2348035550199", email: null } }, "Sold three Shea butter to new customer Zainab, phone 08035550199, paid cash, pickup");
    // Fault the final saved-result UPDATE, after the real dispatcher inserted
    // every domain row. PostgreSQL itself must roll the entire approval back.
    const name = `assistant_test_fail_${randomUUID().replaceAll("-", "_")}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."businessId" = '${business.id}' AND NEW."result" IS NOT NULL THEN RAISE EXCEPTION 'assistant integration rollback'; END IF; RETURN NEW; END $$`);
    try {
      await db.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE UPDATE ON "AssistantAction" FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
      try {
        await expect(approveAction(scope, newCustomerSale.id, now)).rejects.toThrow();
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "AssistantAction"`);
      }
    } finally {
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"()`);
    }
    await assertNoSale();
    expect(await db.customer.count({ where: { businessId: business.id, name: "Zainab" } })).toBe(0);
    expect(await db.assistantAction.findUniqueOrThrow({ where: { id: newCustomerSale.id } })).toMatchObject({ status: "PENDING", result: null, approvedAt: null });
    expect(finalizeEffects).not.toHaveBeenCalled();
  });

  it("invalidates a stale catalog price without inserting any sale rows", async () => {
    await db.product.update({ where: { id: fixture.product.id }, data: { price: 6000 } });
    expect((await approveAction(fixture.scope, fixture.sale.id, now)).status).toBe("changed");
    expect((await db.assistantAction.findUniqueOrThrow({ where: { id: fixture.sale.id } })).status).toBe("INVALID");
    await assertNoSale();
  });

  it("serializes an approval racing a catalog price update", async () => {
    const [reply] = await Promise.all([
      approveAction(fixture.scope, fixture.sale.id, now),
      db.product.update({ where: { id: fixture.product.id }, data: { price: 6000 } }),
    ]);
    expect(["approved", "changed"]).toContain(reply.status);
    const receipts = await db.receipt.findMany({ where: { businessId: fixture.business.id }, include: { lines: true } });
    if (reply.status === "approved") {
      expect(receipts).toHaveLength(1);
      expect(Number(receipts[0]!.total)).toBe(15000);
      expect(Number(receipts[0]!.lines[0]!.unitPrice)).toBe(5000);
    } else await assertNoSale();
  });

  it("permits only one of two conversations competing for the last three units", async () => {
    const { option, request, scope, business } = fixture;
    await db.productOption.update({ where: { id: option.id }, data: { stock: 3 } });
    const otherScope: AssistantScope = { ...scope, channel: "WEB", principalId: fixture.owner.id };
    const [one, two] = await Promise.all([
      draft(scope, request, "Sold three Shea butter to Amaka, paid cash, pickup"),
      draft(otherScope, request, "Sold three Shea butter to Amaka, paid cash, pickup"),
    ]);
    const replies = await Promise.all([approveAction(scope, one.id, now), approveAction(otherScope, two.id, now)]);
    expect(replies.map((reply) => reply.status).sort()).toEqual(["approved", "changed"]);
    expect(await db.receipt.count({ where: { businessId: business.id } })).toBe(1);
    expect(await db.order.count({ where: { businessId: business.id } })).toBe(1);
    expect((await db.productOption.findUniqueOrThrow({ where: { id: option.id } })).stock).toBe(0);
  });

  it("refuses a sale when a checkout holds its stock", async () => {
    await db.order.create({ data: {
      businessId: fixture.business.id, slug: `hold-${randomUUID()}`, source: "ONLINE", fulfilment: "PICKUP",
      status: "AWAITING_PAYMENT", holdExpiresAt: new Date(Date.now() + 60_000),
      subtotal: 40000, total: 40000, currency: "NGN", clientName: "Checkout customer",
      lines: { create: [{ productOptionId: fixture.option.id, name: "Shea butter", quantity: 8, unitPrice: 5000, total: 40000 }] },
    } });
    expect((await approveAction(fixture.scope, fixture.sale.id, now)).status).toBe("changed");
    expect(await db.receipt.count({ where: { businessId: fixture.business.id } })).toBe(0);
    expect(await db.payment.count({ where: { businessId: fixture.business.id } })).toBe(0);
    expect((await db.productOption.findUniqueOrThrow({ where: { id: fixture.option.id } })).stock).toBe(10);
  });

  it("reserves exactly the hundredth paid turn under concurrency and replays its reservation", async () => {
    const { business, scope } = fixture;
    await db.assistantDailyUsage.create({ data: { businessId: business.id, day: lagosDay(now), count: 99 } });
    const reservations = await Promise.all([reserveUsage(scope, "quota-a", "TEXT", now), reserveUsage(scope, "quota-b", "VOICE", now)]);
    expect(reservations.filter(Boolean)).toHaveLength(1);
    expect(await db.assistantUsage.count({ where: { businessId: business.id } })).toBe(1);
    expect((await db.assistantDailyUsage.findUniqueOrThrow({ where: { businessId_day: { businessId: business.id, day: lagosDay(now) } } })).count).toBe(100);
    const winner = reservations[0] ? "quota-a" : "quota-b";
    const replay = await reserveUsage(scope, winner, "TEXT", now);
    expect(replay).toMatchObject({ id: reservations.find(Boolean)!.id, fresh: false });
    expect((await db.assistantDailyUsage.findUniqueOrThrow({ where: { businessId_day: { businessId: business.id, day: lagosDay(now) } } })).count).toBe(100);
  });

  it("claims nonadjacent replayed chat IDs only once", async () => {
    const session = await chatSessionService.getOrCreateSession(fixture.identity.id);
    expect(await chatSessionService.claimMessage(session.id, "message-1")).toBe(true);
    expect(await chatSessionService.claimMessage(session.id, "message-2")).toBe(true);
    expect(await chatSessionService.claimMessage(session.id, "message-1")).toBe(false);
    const competing = await Promise.all([chatSessionService.claimMessage(session.id, "message-3"), chatSessionService.claimMessage(session.id, "message-3")]);
    expect(competing.sort()).toEqual([false, true]);
    expect(await db.processedChatMessage.count({ where: { sessionId: session.id } })).toBe(3);
  });

  it.each(["principal", "channel", "business"] as const)("rejects a foreign %s without domain writes", async (field) => {
    const scope = { ...fixture.scope };
    if (field === "principal") scope.principalId = "foreign-owner";
    if (field === "channel") scope.channel = "INSTAGRAM";
    if (field === "business") scope.businessId = "foreign-business";
    await expect(approveAction(scope, fixture.sale.id, now)).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });
    await assertNoSale();
  });

  it("expires drafts at the exact boundary without domain writes", async () => {
    await db.assistantAction.update({ where: { id: fixture.sale.id }, data: { expiresAt: now } });
    expect((await approveAction(fixture.scope, fixture.sale.id, now)).status).toBe("expired");
    expect((await db.assistantAction.findUniqueOrThrow({ where: { id: fixture.sale.id } })).status).toBe("EXPIRED");
    await assertNoSale();
  });

  it("keeps committed success replayable when post-commit delivery fails", async () => {
    vi.mocked(finalizeEffects).mockRejectedValueOnce(new Error("remote PDF delivery failed"));
    const first = await approveAction(fixture.scope, fixture.sale.id, now);
    const replay = await approveAction(fixture.scope, fixture.sale.id, now);
    expect(first.status).toBe("approved");
    expect(replay).toMatchObject({ status: "already_done", result: first.result });
    expect(await db.receipt.count({ where: { businessId: fixture.business.id } })).toBe(1);
    expect(finalizeEffects).toHaveBeenCalledTimes(1);
  });
});

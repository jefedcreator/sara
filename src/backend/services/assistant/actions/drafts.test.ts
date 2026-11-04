import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: {
  assistantConversation: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  assistantAction: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
} }));

import { db } from "@/server/db";
import type { AssistantScope } from "../types";
import { assertDraftApprovableInTransaction, cancelDraft, changeDraft, createDraft, getPendingDraft } from "./drafts";
import type { PreparedAction } from "./types";

const mocked = db as any;
const now = new Date("2026-11-04T12:00:00.000Z");
const scope: AssistantScope = { businessId: "business-1", channel: "WHATSAPP", principalId: "owner-1" };
const publication = { conversationId: "conversation-1", leaseToken: "generation-1" };
const prepared: PreparedAction<"create_customer"> = {
  kind: "create_customer", payload: { name: "Amaka", phone: null, email: null, address: null, notes: null },
  snapshot: { businessId: scope.businessId, businessCurrency: "NGN", originalRequest: { kind: "create_customer", name: "Amaka", phone: null, email: null, address: null, notes: null } },
};
let state: { conversation: any; actions: any[] };
let failInsert: boolean;
let nextId: number;

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "conversation") return matches(state.conversation, expected);
    const actual = row[key];
    if (typeof expected === "object" && expected !== null && !(expected instanceof Date)) {
      const filter = expected as any;
      if ("gt" in filter) return actual > filter.gt;
      if ("lte" in filter) return actual <= filter.lte;
      if ("in" in filter) return filter.in.includes(actual);
    }
    return actual === expected;
  });
}
function action(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-old", conversationId: publication.conversationId, businessId: scope.businessId,
    kind: prepared.kind, payload: prepared.payload, snapshot: prepared.snapshot,
    summary: "Create customer Amaka?", status: "PENDING", createdAt: now,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  failInsert = false;
  nextId = 1;
  state = {
    conversation: { id: publication.conversationId, ...scope, memoryVersion: 3, leaseToken: publication.leaseToken, leaseExpiresAt: new Date(now.getTime() + 30_000), editingActionId: null, clarification: null },
    actions: [],
  };
  mocked.$transaction.mockImplementation(async (work: any) => {
    const prior = structuredClone(state);
    try { return await work(mocked); }
    catch (error) { state = prior; throw error; }
  });
  mocked.assistantConversation.findFirst.mockImplementation(async ({ where }: any) => matches(state.conversation, where) ? structuredClone(state.conversation) : null);
  mocked.assistantConversation.updateMany.mockImplementation(async ({ where, data }: any) => {
    if (!matches(state.conversation, where)) return { count: 0 };
    Object.assign(state.conversation, data);
    return { count: 1 };
  });
  mocked.assistantConversation.update.mockImplementation(async ({ data }: any) => Object.assign(state.conversation, data));
  mocked.assistantAction.findFirst.mockImplementation(async ({ where }: any) => state.actions.find((row) => matches(row, where)) ?? null);
  mocked.assistantAction.findMany.mockImplementation(async ({ where }: any) => state.actions.filter((row) => matches(row, where)));
  mocked.assistantAction.updateMany.mockImplementation(async ({ where, data }: any) => {
    const found = state.actions.filter((row) => matches(row, where));
    found.forEach((row) => Object.assign(row, data));
    return { count: found.length };
  });
  mocked.assistantAction.create.mockImplementation(async ({ data }: any) => {
    if (failInsert) throw new Error("INSERT_FAILED");
    const created = action({ id: `draft-${nextId++}`, ...data });
    state.actions.push(created);
    return created;
  });
});
afterEach(() => vi.useRealTimers());

describe("immutable draft publication", () => {
  it("stores exact code text, expires at 24 hours, and atomically replaces the previous preview", async () => {
    state.actions.push(action());
    state.conversation.editingActionId = "draft-old";
    state.conversation.clarification = { question: "Which customer?" };
    const result = await createDraft(scope, prepared, 3, now, publication);
    expect(result).toEqual({ id: "draft-1", summary: "Create customer Amaka?", expiresAt: "2026-11-05T12:00:00.000Z", status: "PENDING" });
    expect(state.actions.map((row) => [row.id, row.status])).toEqual([["draft-old", "REPLACED"], ["draft-1", "PENDING"]]);
    expect(state.actions[1].payload).toEqual(prepared.payload);
    expect(state.actions[1].snapshot).toEqual(prepared.snapshot);
    expect(state.conversation.editingActionId).toBeNull();
    expect(mocked.assistantConversation.updateMany).toHaveBeenCalledWith({
      where: { id: publication.conversationId, ...scope, memoryVersion: 3, leaseToken: publication.leaseToken, leaseExpiresAt: { gt: now } }, data: { lastActiveAt: now },
    });
  });

  it("preserves the prior pending preview and editing context if replacement insert fails", async () => {
    state.actions.push(action());
    state.conversation.editingActionId = "draft-old";
    state.conversation.clarification = { question: "Which customer?" };
    failInsert = true;
    await expect(createDraft(scope, prepared, 3, now, publication)).rejects.toThrow("INSERT_FAILED");
    expect(state.actions.map((row) => [row.id, row.status])).toEqual([["draft-old", "PENDING"]]);
    expect(state.conversation.editingActionId).toBe("draft-old");
    expect(state.conversation.clarification).toEqual({ question: "Which customer?" });
    expect(mocked.assistantConversation.update).not.toHaveBeenCalled();
  });

  it.each([
    { leaseToken: "other-generation" },
    { memoryVersion: 4 },
    { leaseExpiresAt: now },
    { leaseExpiresAt: new Date(now.getTime() - 1) },
    { businessId: "other-business" },
    { principalId: "other-owner" },
    { channel: "WEB" },
  ])("fences stale or foreign publication before touching pending previews: %o", async (changes) => {
    state.actions.push(action());
    Object.assign(state.conversation, changes);
    await expect(createDraft(scope, prepared, 3, now, publication)).rejects.toMatchObject({ code: "ASSISTANT_TURN_STALE" });
    expect(state.actions[0].status).toBe("PENDING");
    expect(mocked.assistantAction.create).not.toHaveBeenCalled();
    expect(mocked.assistantAction.updateMany).not.toHaveBeenCalled();
  });

  it("requires a publication lease and scoped resolver snapshot", async () => {
    await expect(createDraft(scope, prepared, 3, now, { ...publication, leaseToken: "" })).rejects.toMatchObject({ code: "ASSISTANT_LEASE_REQUIRED" });
    await expect(createDraft(scope, { ...prepared, snapshot: { ...prepared.snapshot, businessId: "foreign" } }, 3, now, publication)).rejects.toMatchObject({ code: "ASSISTANT_DRAFT_UNTRUSTED" });
    await expect(createDraft(scope, { ...prepared, snapshot: { ...prepared.snapshot, originalRequest: { kind: "adjust_stock" } } }, 3, now, publication)).rejects.toMatchObject({ code: "ASSISTANT_DRAFT_UNTRUSTED" });
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it("checks lease expiry at publication even if resolution began under a live lease", async () => {
    state.actions.push(action());
    vi.setSystemTime(new Date(now.getTime() + 31_000));
    await expect(createDraft(scope, prepared, 3, now, publication)).rejects.toMatchObject({ code: "ASSISTANT_TURN_STALE" });
    expect(state.actions[0].status).toBe("PENDING");
    expect(mocked.assistantAction.create).not.toHaveBeenCalled();
  });

  it("copies inputs before yielding so stored data and summary cannot diverge", async () => {
    const changing = { ...structuredClone(prepared), payload: { name: "Amaka", phone: null, email: null, address: null, notes: null } };
    const pending = createDraft(scope, changing, 3, now, publication);
    changing.payload.name = "Different person";
    await pending;
    expect(state.actions[0].payload.name).toBe("Amaka");
    expect(state.actions[0].summary).toBe("Create customer Amaka?");
  });
});

describe("draft expiry, editing and cancellation", () => {
  it("keeps a preview until one millisecond before its 24-hour boundary", async () => {
    state.actions.push(action());
    const beforeExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000 - 1);
    expect(await getPendingDraft(scope, beforeExpiry)).toMatchObject({ id: "draft-old", status: "PENDING" });
    expect(await getPendingDraft(scope, new Date(beforeExpiry.getTime() + 1))).toBeNull();
    expect(state.actions[0].status).toBe("EXPIRED");
  });

  it("marks expired previews EXPIRED instead of REPLACED during publication", async () => {
    state.actions.push(action({ expiresAt: now }));
    await createDraft(scope, prepared, 3, now, publication);
    expect(state.actions[0].status).toBe("EXPIRED");
  });

  it("keeps changed text immutable and pending but refuses approval until a replacement is shown", async () => {
    state.actions.push(action());
    const original = structuredClone(state.actions[0]);
    expect(await changeDraft(scope, "draft-old")).toMatchObject({ id: "draft-old", status: "PENDING" });
    expect(state.actions[0]).toEqual(original);
    expect(await getPendingDraft(scope, now)).toMatchObject({ id: "draft-old" });
    await expect(assertDraftApprovableInTransaction(mocked, scope, "draft-old", now)).rejects.toMatchObject({ code: "ASSISTANT_DRAFT_EDITING" });
    const replacement = await createDraft(scope, prepared, 3, now, publication);
    await expect(assertDraftApprovableInTransaction(mocked, scope, replacement.id, now)).resolves.toMatchObject({ id: replacement.id });
    expect(state.conversation.editingActionId).toBeNull();
  });

  it.each(["REPLACED", "APPROVED", "CANCELLED", "INVALID"])("refuses edits and approval for %s IDs", async (status) => {
    state.actions.push(action({ status }));
    await expect(changeDraft(scope, "draft-old")).rejects.toMatchObject({ code: "ASSISTANT_DRAFT_NOT_PENDING" });
    await expect(assertDraftApprovableInTransaction(mocked, scope, "draft-old", now)).rejects.toMatchObject({ code: "ASSISTANT_DRAFT_NOT_PENDING" });
  });

  it("persists expiry and clears editing when a late change request arrives", async () => {
    state.actions.push(action({ expiresAt: now }));
    state.conversation.editingActionId = "draft-old";
    await expect(changeDraft(scope, "draft-old")).rejects.toMatchObject({ code: "ASSISTANT_DRAFT_EXPIRED" });
    expect(state.actions[0].status).toBe("EXPIRED");
    expect(state.conversation.editingActionId).toBeNull();
  });

  it("refuses expired approvals even before the expiry sweep", async () => {
    state.actions.push(action({ expiresAt: now }));
    await expect(assertDraftApprovableInTransaction(mocked, scope, "draft-old", now)).rejects.toMatchObject({ code: "ASSISTANT_DRAFT_EXPIRED" });
  });

  it.each([
    { ...scope, businessId: "foreign" },
    { ...scope, principalId: "foreign" },
    { ...scope, channel: "WEB" as const },
  ])("does not expose, edit, cancel or approve another scope's preview: %o", async (foreign) => {
    state.actions.push(action());
    expect(await getPendingDraft(foreign, now)).toBeNull();
    await expect(changeDraft(foreign, "draft-old")).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });
    await expect(cancelDraft(foreign, "draft-old")).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });
    await expect(assertDraftApprovableInTransaction(mocked, foreign, "draft-old", now)).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });
    expect(state.actions[0].status).toBe("PENDING");
  });

  it("rejects an ID from another conversation even inside the same business", async () => {
    state.actions.push(action({ conversationId: "another-conversation" }));
    await expect(changeDraft(scope, "draft-old")).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });
    await expect(cancelDraft(scope, "draft-old")).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });
  });

  it("cancels the pending preview and clears editing without changing stored summary or payload", async () => {
    state.actions.push(action());
    state.conversation.editingActionId = "draft-old";
    await cancelDraft(scope);
    expect(state.actions[0]).toMatchObject({ status: "CANCELLED", summary: "Create customer Amaka?", payload: prepared.payload });
    expect(state.conversation.editingActionId).toBeNull();
    expect(await getPendingDraft(scope, now)).toBeNull();
  });

  it("does not let a replaced ID cancel the current preview", async () => {
    state.actions.push(action({ status: "REPLACED" }), action({ id: "draft-current" }));
    await expect(cancelDraft(scope, "draft-old")).rejects.toMatchObject({ code: "ASSISTANT_DRAFT_NOT_PENDING" });
    expect(state.actions[1].status).toBe("PENDING");
  });
});

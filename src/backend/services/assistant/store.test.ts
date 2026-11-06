import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedDb = vi.hoisted(() => ({
    assistantConversation: {
      upsert: vi.fn<(args: Prisma.AssistantConversationUpsertArgs) => Promise<unknown>>(),
      findFirst: vi.fn<(args: Prisma.AssistantConversationFindFirstArgs) => Promise<unknown>>(),
      findUniqueOrThrow: vi.fn<(args: Prisma.AssistantConversationFindUniqueOrThrowArgs) => Promise<unknown>>(),
      update: vi.fn<(args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>>(),
      updateMany: vi.fn<(args: Prisma.AssistantConversationUpdateManyArgs) => Promise<{ count: number }>>(),
    },
    assistantTurn: {
      findUnique: vi.fn<(args: Prisma.AssistantTurnFindUniqueArgs) => Promise<unknown>>(),
      findMany: vi.fn<(args: Prisma.AssistantTurnFindManyArgs) => Promise<unknown>>(),
      upsert: vi.fn<(args: Prisma.AssistantTurnUpsertArgs) => Promise<unknown>>(),
      create: vi.fn<(args: Prisma.AssistantTurnCreateArgs) => Promise<unknown>>(),
      updateMany: vi.fn<(args: Prisma.AssistantTurnUpdateManyArgs) => Promise<{ count: number }>>(),
      deleteMany: vi.fn(),
    },
    assistantAction: {
      findFirst: vi.fn<(args: Prisma.AssistantActionFindFirstArgs) => Promise<unknown>>(),
      updateMany: vi.fn<(args: Prisma.AssistantActionUpdateManyArgs) => Promise<{ count: number }>>(),
    },
    assistantUsage: {
      findUnique: vi.fn<(args: Prisma.AssistantUsageFindUniqueArgs) => Promise<unknown>>(),
      update: vi.fn(),
    },
    $transaction: vi.fn<(callback: (client: unknown) => Promise<unknown>) => Promise<unknown>>(),
}));
vi.mock("@/server/db", () => ({ db: mockedDb }));

import {
  assertConversation, claimTurn, claimTurnLease, controlTurn, getAction, INTERRUPTED_TURN_REPLY, loadRecent,
  releaseTurn, resetMemory, saveTurn, assertTurnCurrent, loadTurnMemory, selectClarification,
  saveClarification, saveReadPages, hasPendingClarification, hasPendingReadPage,
} from "./store";
import type { AssistantScope } from "./types";

const scope: AssistantScope = {
  businessId: "biz_1", channel: "WHATSAPP", principalId: "identity_1",
};
const now = new Date("2026-11-04T12:00:00Z");
const conversation = {
  id: "conv_1", ...scope, lastActiveAt: now, memoryVersion: 2,
  clarification: null, editingActionId: null, leaseToken: null, leaseExpiresAt: null,
};
function turnRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "turn_1", conversationId: "conv_1", requestId: "r1", memoryVersion: 2,
    userText: "hello", transcript: null, toolRecords: [], reply: { text: "hi" },
    state: "DONE", createdAt: now, ...overrides,
  };
}
const liveConversation = { ...conversation, leaseToken: "generation-1", leaseExpiresAt: new Date(now.getTime() + 30_000) };
function liveSave() { mockedDb.assistantConversation.findUniqueOrThrow.mockResolvedValue(liveConversation); }
const savedTurn = { userText: "sales?", reply: "NGN 45,000", memoryVersion: 2, leaseToken: "generation-1" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mockedDb.$transaction.mockImplementation((callback) => callback(mockedDb));
  mockedDb.assistantConversation.upsert.mockResolvedValue(conversation);
  mockedDb.assistantConversation.findFirst.mockResolvedValue(conversation);
  mockedDb.assistantConversation.findUniqueOrThrow.mockResolvedValue(conversation);
  mockedDb.assistantConversation.updateMany.mockResolvedValue({ count: 1 });
  mockedDb.assistantConversation.update.mockResolvedValue({ ...conversation, memoryVersion: 3 });
  mockedDb.assistantTurn.findUnique.mockResolvedValue(null);
  mockedDb.assistantUsage.findUnique.mockResolvedValue(null);
  mockedDb.assistantTurn.findMany.mockResolvedValue([]);
  mockedDb.assistantTurn.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.useRealTimers());

describe("atomic typed controls", () => {
  const pending = { id: "a1", summary: "Create an invoice?", expiresAt: new Date(now.getTime() + 60_000), status: "PENDING" };
  it("cancels pending actions and fences active work in the same transaction as its DONE reply", async () => {
    const result = await controlTurn(scope, "cancel-1", "cancel");
    expect(result).toMatchObject({ requestId: "cancel-1", conversationId: "conv_1", draft: null, result: null });
    expect(mockedDb.assistantConversation.update).toHaveBeenCalledWith({ where: { id: "conv_1" }, data: {
      memoryVersion: { increment: 1 }, clarification: Prisma.DbNull, editingActionId: null,
      leaseToken: null, leaseExpiresAt: null, lastActiveAt: now,
    } });
    expect(mockedDb.assistantAction.updateMany).toHaveBeenCalledWith({
      where: { conversationId: "conv_1", businessId: scope.businessId, conversation: scope, status: "PENDING" }, data: { status: "CANCELLED" },
    });
    expect(mockedDb.assistantTurn.create).toHaveBeenCalledWith({ data: {
      conversationId: "conv_1", requestId: "cancel-1", memoryVersion: 3, userText: "cancel", transcript: null,
      toolRecords: [], state: "DONE", reply: { text: result.reply, draft: null, result: null },
    } });
    expect(mockedDb.assistantUsage.findUnique).not.toHaveBeenCalled();
  });
  it("replays an old cancellation without resetting memory or cancelling a newer draft", async () => {
    mockedDb.assistantTurn.findUnique.mockResolvedValue(turnRow({ requestId: "cancel-1", reply: { text: "Cancelled.", draft: null, result: null } }));
    expect(await controlTurn(scope, "cancel-1", "cancel")).toMatchObject({ requestId: "cancel-1", reply: "Cancelled." });
    expect(mockedDb.assistantConversation.update).not.toHaveBeenCalled();
    expect(mockedDb.assistantAction.updateMany).not.toHaveBeenCalled();
    expect(mockedDb.assistantTurn.create).not.toHaveBeenCalled();
  });
  it("locks the full scope before reading replay state", async () => {
    mockedDb.assistantConversation.updateMany.mockResolvedValue({ count: 0 });
    await expect(controlTurn(scope, "r1", "cancel")).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    expect(mockedDb.assistantConversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conv_1", ...scope }, data: { memoryVersion: { increment: 0 } },
    });
    expect(mockedDb.assistantTurn.findUnique).not.toHaveBeenCalled();
    expect(mockedDb.assistantAction.updateMany).not.toHaveBeenCalled();
  });
  it("leaves a valid pending draft available after menu while expiring elapsed drafts", async () => {
    mockedDb.assistantAction.findFirst.mockResolvedValue(pending);
    const result = await controlTurn(scope, "menu-1", "menu");
    expect(result.draft).toEqual({ ...pending, expiresAt: pending.expiresAt.toISOString() });
    expect(mockedDb.assistantAction.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { conversationId: "conv_1", businessId: scope.businessId, conversation: scope, status: "PENDING", expiresAt: { lte: now } },
      data: { status: "EXPIRED" },
    });
    expect(mockedDb.assistantAction.findFirst).toHaveBeenCalledWith({
      where: { conversationId: "conv_1", businessId: scope.businessId, conversation: scope, status: "PENDING", expiresAt: { gt: now } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });
  it("cannot replace a running request's input by reusing its id for cancel", async () => {
    mockedDb.assistantTurn.findUnique.mockResolvedValue(turnRow({ state: "RUNNING", reply: null }));
    await expect(controlTurn(scope, "r1", "cancel")).rejects.toMatchObject({ code: "ASSISTANT_BUSY" });
    expect(mockedDb.assistantConversation.update).not.toHaveBeenCalled();
    expect(mockedDb.assistantAction.updateMany).not.toHaveBeenCalled();
  });
  it.each(["", "approve:a1", "x".repeat(201)])("rejects reserved or malformed request ids", async (requestId) => {
    await expect(controlTurn(scope, requestId, "cancel")).rejects.toMatchObject({ code: "ASSISTANT_INVALID_REQUEST_ID" });
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
  });
});

describe("scope boundaries", () => {
  it("requires business, principal and channel for conversation access", async () => {
    mockedDb.assistantConversation.findFirst.mockImplementation(async ({ where }) =>
      where?.businessId === scope.businessId && where.channel === scope.channel &&
      where.principalId === scope.principalId ? conversation : null,
    );
    await expect(assertConversation(scope, "conv_1")).resolves.toEqual(conversation);
    for (const foreign of [
      { ...scope, businessId: "other" }, { ...scope, principalId: "other" },
      { ...scope, channel: "WEB" as const },
    ]) {
      await expect(assertConversation(foreign, "conv_1")).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    }
  });
  it("scopes an action through its conversation", async () => {
    mockedDb.assistantAction.findFirst.mockResolvedValue(null);
    await expect(getAction(scope, "foreign")).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });
    expect(mockedDb.assistantAction.findFirst).toHaveBeenCalledWith({ where: {
      id: "foreign", businessId: scope.businessId, conversation: scope,
    } });
  });
});

describe("bounded memory with durable replay", () => {
  it("keeps 29-minute history and omits 31-minute history", async () => {
    mockedDb.assistantTurn.findMany.mockResolvedValue([
      turnRow({ userText: "recent", createdAt: new Date(now.getTime() - 29 * 60_000) }),
      turnRow({ userText: "old", createdAt: new Date(now.getTime() - 31 * 60_000) }),
    ]);
    expect((await loadRecent(scope, now)).map((turn) => turn.userText)).toEqual(["recent"]);
    expect(mockedDb.assistantTurn.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 12, where: expect.objectContaining({ memoryVersion: 2, state: "DONE" }) as unknown,
    }));
  });
  it("returns chronological history and counts tool content toward the budget", async () => {
    mockedDb.assistantTurn.findMany.mockResolvedValue([
      turnRow({ userText: "new", toolRecords: [{ name: "lookup", arguments: {}, output: "x".repeat(9_000) }] }),
      turnRow({ userText: "old", toolRecords: [{ name: "lookup", arguments: {}, output: "x".repeat(9_000) }] }),
    ]);
    expect((await loadRecent(scope, now)).map((turn) => turn.userText)).toEqual(["new"]);
  });
  it("drops a whole oversized latest turn rather than exceeding 16,000 characters", async () => {
    mockedDb.assistantTurn.findMany.mockResolvedValue([turnRow({ userText: "x".repeat(16_001) })]);
    expect(await loadRecent(scope, now)).toEqual([]);
  });
  it("ignores malformed stored JSON", async () => {
    mockedDb.assistantTurn.findMany.mockResolvedValue([
      turnRow({ reply: { nonsense: true } }), turnRow({ toolRecords: [{ name: "missing-output" }] }),
    ]);
    expect(await loadRecent(scope, now)).toEqual([]);
  });
  it("resets clarification/history without expiring a 24-hour action", async () => {
    await resetMemory(scope);
    expect(mockedDb.assistantConversation.update).toHaveBeenCalledWith({
      where: { id: "conv_1" }, data: {
        memoryVersion: { increment: 1 }, clarification: Prisma.DbNull,
        editingActionId: null, lastActiveAt: now,
      },
    });
    expect(mockedDb.assistantAction.updateMany).not.toHaveBeenCalled();
  });
  it("never deletes completed idempotency records when saving newer turns", async () => {
    liveSave();
    await saveTurn(scope, "r1", savedTurn);
    expect(mockedDb.assistantTurn.deleteMany).not.toHaveBeenCalled();
    expect(mockedDb.assistantTurn.findMany).not.toHaveBeenCalled();
    mockedDb.assistantTurn.findUnique.mockResolvedValue(turnRow({ requestId: "old-request" }));
    await expect(claimTurn(scope, "old-request")).resolves.toMatchObject({ requestId: "old-request", reply: "hi" });
  });
});

describe("lease generations", () => {
  it("terminally recovers a paid orphan after lease expiry without exposing a new execution lease", async () => {
    const first = await claimTurnLease(scope, "crashed-request");
    expect(first).toMatchObject({ status: "claimed" });
    const priorUsage = { id: "usage-1", inputTokens: 500, outputTokens: 20 };
    // The reservation survived; no completion ran after the paid provider call.
    mockedDb.assistantUsage.findUnique.mockResolvedValue(priorUsage);
    mockedDb.assistantTurn.findUnique.mockResolvedValue(turnRow({ requestId: "crashed-request", state: "RUNNING", reply: null }));
    vi.setSystemTime(new Date(now.getTime() + 31_000));
    const recovered = await claimTurnLease(scope, "crashed-request");
    expect(recovered).toEqual({ conversationId: "conv_1", requestId: "crashed-request", transcript: null, reply: INTERRUPTED_TURN_REPLY, draft: null, result: null });
    expect(recovered).not.toHaveProperty("leaseToken");
    expect(mockedDb.assistantTurn.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { reply: { text: INTERRUPTED_TURN_REPLY, draft: null, result: null }, state: "DONE" } }));
    expect(mockedDb.assistantUsage.update).not.toHaveBeenCalled();
  });
  it("recovers after a reset without moving old inputs into the new memory version", async () => {
    mockedDb.assistantConversation.findUniqueOrThrow.mockResolvedValue({ ...conversation, memoryVersion: 3 });
    mockedDb.assistantTurn.findUnique.mockResolvedValue(turnRow({ memoryVersion: 2, state: "ERROR" }));
    mockedDb.assistantUsage.findUnique.mockResolvedValue({ id: "old-reservation" });
    await expect(claimTurnLease(scope, "r1")).resolves.toMatchObject({ reply: INTERRUPTED_TURN_REPLY });
    expect(mockedDb.assistantTurn.upsert.mock.lastCall?.[0].update).not.toHaveProperty("memoryVersion");
    mockedDb.assistantConversation.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveTurn(scope, "r1", savedTurn)).rejects.toMatchObject({ code: "ASSISTANT_TURN_STALE" });
    expect(mockedDb.assistantUsage.update).not.toHaveBeenCalled();
  });
  it("rejects paid claims in the approval namespace", async () => {
    await expect(claimTurnLease(scope, "approve:action-1")).rejects.toMatchObject({ code: "ASSISTANT_REQUEST_ID_RESERVED" });
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
  });
  it("captures the memory version only after the atomic lease acquisition", async () => {
    mockedDb.assistantConversation.findUniqueOrThrow.mockResolvedValue({ ...conversation, memoryVersion: 3 });
    const claim = await claimTurnLease(scope, "r1");
    expect(claim).toMatchObject({ status: "claimed", memoryVersion: 3, leaseToken: expect.any(String) as unknown });
    expect(mockedDb.assistantConversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conv_1", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
      data: { leaseToken: expect.any(String) as unknown, leaseExpiresAt: new Date(now.getTime() + 30_000), lastActiveAt: now },
    });
  });
  it("gives a reclaimed request a new generation", async () => {
    const first = await claimTurnLease(scope, "same-request");
    const second = await claimTurnLease(scope, "same-request");
    expect(first).toMatchObject({ status: "claimed" });
    expect(second).toMatchObject({ status: "claimed" });
    if (typeof first === "object" && "leaseToken" in first && typeof second === "object" && "leaseToken" in second) {
      expect(first.leaseToken).not.toBe(second.leaseToken);
    }
  });
  it("returns busy without writing a turn when acquisition loses", async () => {
    mockedDb.assistantConversation.updateMany.mockResolvedValue({ count: 0 });
    await expect(claimTurnLease(scope, "r1")).resolves.toBe("busy");
    expect(mockedDb.assistantTurn.upsert).not.toHaveBeenCalled();
  });
  it("replays a completion that raced the initial lookup", async () => {
    mockedDb.assistantTurn.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(turnRow());
    await expect(claimTurnLease(scope, "r1")).resolves.toMatchObject({ reply: "hi" });
    expect(mockedDb.assistantTurn.upsert).not.toHaveBeenCalled();
  });
  it("fences stale completions after reset or reacquisition", async () => {
    mockedDb.assistantConversation.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveTurn(scope, "r1", savedTurn)).rejects.toMatchObject({ code: "ASSISTANT_TURN_STALE" });
    expect(mockedDb.assistantTurn.updateMany).not.toHaveBeenCalled();
    expect(mockedDb.assistantConversation.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedDb.assistantConversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conv_1", ...scope }, data: { memoryVersion: { increment: 0 } },
    });
  });
  it("stores the exact reply only for its RUNNING generation", async () => {
    liveSave();
    const draft = { id: "draft-1", summary: "Invoice Tolu?", expiresAt: "2026-11-05T12:00:00Z", status: "PENDING" as const };
    await saveTurn(scope, "r1", { ...savedTurn, draft });
    expect(mockedDb.assistantTurn.updateMany).toHaveBeenCalledWith({
      where: { conversationId: "conv_1", requestId: "r1", memoryVersion: 2, state: "RUNNING" },
      data: { userText: "sales?", transcript: null, toolRecords: [], reply: { text: "NGN 45,000", draft, result: null }, state: "DONE" },
    });
  });
  it("cannot release the newer generation for a retried request", async () => {
    await releaseTurn(scope, "same-request", "old-generation");
    expect(mockedDb.assistantConversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conv_1", leaseToken: "old-generation" },
      data: { leaseToken: null, leaseExpiresAt: null },
    });
  });
});

describe("post-lock generation checks", () => {
  function pauseLock() {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<void>((resolve) => { entered = resolve; });
    mockedDb.assistantConversation.updateMany.mockImplementationOnce(async () => { entered(); await waiting; return { count: 1 }; });
    return { release, locked };
  }
  it("uses fresh activity/context after a delayed claim lock without rewriting a stale snapshot", async () => {
    const old = { ...conversation, lastActiveAt: new Date(now.getTime() - 31 * 60_000) };
    mockedDb.assistantConversation.upsert.mockResolvedValue(old);
    const gate = pauseLock();
    const pending = claimTurnLease(scope, "r1");
    await gate.locked;
    const fresh = { ...conversation, lastActiveAt: now, editingActionId: "new-preview", clarification: { question: "new" } };
    mockedDb.assistantConversation.findUniqueOrThrow.mockResolvedValue(fresh);
    gate.release(); await pending;
    expect(mockedDb.assistantConversation.updateMany.mock.calls[0]?.[0].data).toEqual({ memoryVersion: { increment: 0 } });
    expect(mockedDb.assistantConversation.updateMany.mock.calls[1]?.[0].data).not.toHaveProperty("clarification");
    expect(mockedDb.assistantConversation.updateMany.mock.calls[1]?.[0].data).not.toHaveProperty("editingActionId");
  });
  it("does not rewind activity when the locked conversation is busy", async () => {
    mockedDb.assistantConversation.upsert.mockResolvedValue({ ...conversation, lastActiveAt: new Date(0) });
    mockedDb.assistantConversation.findUniqueOrThrow.mockResolvedValue(liveConversation);
    await expect(claimTurnLease(scope, "r1")).resolves.toBe("busy");
    expect(mockedDb.assistantConversation.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedDb.assistantConversation.updateMany).toHaveBeenCalledWith({
      where: { id: conversation.id, ...scope }, data: { memoryVersion: { increment: 0 } },
    });
  });
  it.each(["expiry", "token", "reset", "abort"])("rejects %s that arrives during a save lock wait", async (change) => {
    liveSave();
    const gate = pauseLock();
    const controller = new AbortController();
    const pending = saveTurn(scope, "r1", savedTurn, controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    await gate.locked;
    if (change === "expiry") vi.setSystemTime(liveConversation.leaseExpiresAt);
    if (change === "token") mockedDb.assistantConversation.findUniqueOrThrow.mockResolvedValue({ ...liveConversation, leaseToken: "new" });
    if (change === "reset") mockedDb.assistantConversation.findUniqueOrThrow.mockResolvedValue({ ...liveConversation, memoryVersion: 3 });
    if (change === "abort") controller.abort();
    gate.release(); await rejected;
    expect(mockedDb.assistantTurn.updateMany).not.toHaveBeenCalled();
  });
  it("throws before transaction completion if the final turn write outlives cancellation", async () => {
    liveSave();
    const controller = new AbortController();
    mockedDb.assistantTurn.updateMany.mockImplementation(async () => { controller.abort(); return { count: 1 }; });
    await expect(saveTurn(scope, "r1", savedTurn, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("checks the exact reservation and rechecks reset after its read", async () => {
    mockedDb.assistantConversation.findFirst.mockResolvedValueOnce(liveConversation).mockResolvedValueOnce({ ...liveConversation, memoryVersion: 3 });
    mockedDb.assistantUsage.findUnique.mockResolvedValue({ id: "usage1" });
    await expect(assertTurnCurrent(scope, { conversationId: "conv_1", leaseToken: "generation-1", memoryVersion: 2 }, { id: "usage1", requestId: "r1" })).rejects.toMatchObject({ code: "ASSISTANT_TURN_STALE" });
    expect(mockedDb.assistantUsage.findUnique).toHaveBeenCalledWith({ where: { conversationId_requestId: { conversationId: "conv_1", requestId: "r1" } }, select: { id: true } });
  });
  it("never treats free-text model ids as a saved candidate selection", () => {
    const state = { question: "Which Ada?", choices: [{ id: "owned-a", label: "Ada · 0801" }],
      originalRequest: { kind: "create_customer" as const, name: "Ada", phone: null, email: null, address: null, notes: null },
      evidence: { text: "Create Ada", recentOwnerTexts: [], selectedIds: [] }, createdAt: now.toISOString() };
    expect(selectClarification(state, "owned-a")).toBeNull();
    expect(selectClarification(state, "Ada · 0801")?.evidence.selectedIds).toEqual(["owned-a"]);
    expect(selectClarification(state, "1")?.evidence.text).toBe("Create Ada");
  });
  it("keeps WEB and WhatsApp history scoped at the memory boundary", async () => {
    mockedDb.assistantConversation.findFirst.mockImplementation(async ({ where }) => where?.channel === scope.channel ? liveConversation : null);
    await expect(loadTurnMemory({ ...scope, channel: "WEB" }, { conversationId: "conv_1", leaseToken: "generation-1", memoryVersion: 2 }, now)).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    await expect(loadTurnMemory(scope, { conversationId: "conv_1", leaseToken: "generation-1", memoryVersion: 2 }, now)).resolves.toMatchObject({ clarification: null, editing: null });
  });
});

describe("independent conversation context slots", () => {
  it("preserves a real saved clarification through page writes, last-page consumption and independent expiry", async () => {
    let row = { ...liveConversation, clarification: null as unknown };
    mockedDb.assistantConversation.upsert.mockImplementation(async () => row);
    mockedDb.assistantConversation.findFirst.mockImplementation(async () => row);
    mockedDb.assistantConversation.update.mockImplementation(async ({ data }) => { row = { ...row, ...data }; return row; });
    const fence = { conversationId: "conv_1", leaseToken: "generation-1", memoryVersion: 2 };
    const request = { kind: "create_customer" as const, name: "Ada", phone: null, email: null, address: null, notes: null };
    const evidence = { text: "Create Ada", recentOwnerTexts: ["Use Ada"], selectedIds: ["owned-a"] };
    const clarification = { question: "What should I update?", choices: [], originalRequest: request };
    const signal = new AbortController().signal;
    await saveClarification(scope, fence, clarification, evidence, signal, { id: "owned-a", label: "Ada" });
    await saveReadPages(scope, fence, ["First\n", "Last"], 1, signal);
    const memory = await loadTurnMemory(scope, fence, now);
    expect(memory.clarification).toMatchObject({ ...clarification, evidence, existingSelection: { id: "owned-a", label: "Ada" } });
    expect(memory.readPages?.pages).toEqual(["First\n", "Last"]);
    expect(await hasPendingClarification(scope, now)).toBe(true);
    expect(await hasPendingReadPage(scope, now)).toBe(true);
    await saveReadPages(scope, fence, ["First\n", "Last"], 2, signal);
    expect((await loadTurnMemory(scope, fence, now)).clarification).toEqual(memory.clarification);
    expect(await hasPendingReadPage(scope, now)).toBe(false);

    // A later page save must not renew an older clarification's lifetime.
    vi.setSystemTime(new Date(now.getTime() + 29 * 60_000));
    row = { ...row, leaseExpiresAt: new Date(Date.now() + 30_000) };
    await saveReadPages(scope, fence, ["New", "Page"], 1, signal);
    const later = new Date(now.getTime() + 31 * 60_000);
    row = { ...row, leaseExpiresAt: new Date(later.getTime() + 30_000) };
    vi.setSystemTime(later);
    expect(await hasPendingClarification(scope, later)).toBe(false);
    expect(await hasPendingReadPage(scope, later)).toBe(true);
    expect(await loadTurnMemory(scope, fence, later)).toMatchObject({ clarification: null, readPages: { pages: ["New", "Page"] } });
  });
  it("reads legacy single-slot clarification and page records", async () => {
    const legacy = { question: "Which Ada?", choices: [], originalRequest: { kind: "create_customer", name: "Ada", phone: null, email: null, address: null, notes: null }, evidence: { text: "Ada", recentOwnerTexts: [], selectedIds: [] }, createdAt: now.toISOString() };
    mockedDb.assistantConversation.upsert.mockResolvedValue({ ...liveConversation, clarification: legacy });
    expect(await hasPendingClarification(scope, now)).toBe(true);
    mockedDb.assistantConversation.upsert.mockResolvedValue({ ...liveConversation, clarification: { kind: "read_pages", pages: ["a", "b"], next: 1, createdAt: now.toISOString() } });
    expect(await hasPendingReadPage(scope, now)).toBe(true);
  });
});

describe("fresh claim clock", () => {
  it("starts the full thirty-second lease after a delayed lock acquisition", async () => {
    let release!: () => void;
    let entered!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<void>((resolve) => { entered = resolve; });
    mockedDb.assistantConversation.updateMany.mockImplementationOnce(async () => { entered(); await wait; return { count: 1 }; });
    const pending = claimTurnLease(scope, "r1");
    await locked;
    vi.setSystemTime(new Date(now.getTime() + 20_000));
    release(); await pending;
    expect(mockedDb.assistantConversation.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({
      lastActiveAt: new Date(now.getTime() + 20_000), leaseExpiresAt: new Date(now.getTime() + 50_000),
    }) as unknown }));
  });
});

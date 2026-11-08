import { BadRequestException } from "@/utils/exceptions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeRow = Record<string, unknown>;
type FakeQuery = { where: FakeRow; data: FakeRow };
const mocked = vi.hoisted(() => ({
  assistantConversation: {
    findFirst: vi.fn<(args: FakeQuery) => Promise<FakeRow | null>>(),
    updateMany: vi.fn<(args: FakeQuery) => Promise<{ count: number }>>(),
    update: vi.fn<(args: FakeQuery) => Promise<FakeRow>>(),
  },
  assistantAction: {
    findFirst: vi.fn<(args: FakeQuery) => Promise<FakeRow | null>>(),
    findUniqueOrThrow: vi.fn<(args: FakeQuery) => Promise<FakeRow>>(),
    updateMany: vi.fn<(args: FakeQuery) => Promise<{ count: number }>>(),
    update: vi.fn<(args: FakeQuery) => Promise<FakeRow>>(),
  },
  $transaction: vi.fn<(work: (client: unknown) => Promise<unknown>) => Promise<unknown>>(),
}));
vi.mock("@/server/db", () => ({ db: mocked }));

vi.mock("../config", () => ({ assistantConfig: vi.fn() }));
vi.mock("../usage", () => ({ recordApprovalUsage: vi.fn() }));
vi.mock("./resolve", () => ({ resolveDraft: vi.fn() }));
vi.mock("./execute", () => ({ executeAction: vi.fn(), finalizeEffects: vi.fn() }));
vi.mock("./summary", () => ({ renderSummary: vi.fn() }));

import type { ActionResult } from "@/types/assistant";
import { assistantConfig } from "../config";
import type { AssistantScope } from "../types";
import { recordApprovalUsage } from "../usage";
import { approveAction } from "./approve";
import { executeAction, finalizeEffects } from "./execute";
import { renderSummary } from "./summary";
import { resolveDraft } from "./resolve";
import type { DraftRequest } from "./schemas";
import type { PreparedAction } from "./types";

const now = new Date("2026-11-04T12:00:00.000Z");
const scope: AssistantScope = { businessId: "business-1", channel: "WHATSAPP", principalId: "owner-1" };
const originalRequest: DraftRequest = {
  kind: "create_customer", name: "Amaka", phone: null, email: null, address: null, notes: null,
};
const prepared: PreparedAction<"create_customer"> = {
  kind: "create_customer",
  payload: { name: "Amaka", phone: null, email: null, address: null, notes: null },
  snapshot: {
    businessId: scope.businessId,
    businessCurrency: "NGN",
    originalRequest: { ...originalRequest },
    ownerEvidence: { text: "Add customer Amaka", recentOwnerTexts: [], selectedIds: [] },
    resolvedAt: now.toISOString(),
  },
};
const summary = "Create customer Amaka?";
const result: ActionResult = {
  text: "Customer Amaka created.",
  resourceId: "customer-1",
  link: null,
  affected: ["customers", "dashboard"],
};
const effects = [{ kind: "invoice_pdf" as const, id: "invoice-1" }];

let state: { conversation: FakeRow; actions: FakeRow[] };

function record(value: unknown): FakeRow {
  return typeof value === "object" && value !== null ? value as FakeRow : {};
}
function matches(row: FakeRow, where: FakeRow): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "conversation") return matches(state.conversation, record(expected));
    const actual = row[key];
    if (typeof expected === "object" && expected !== null && !(expected instanceof Date)) {
      const filter = record(expected);
      if ("gt" in filter) return actual instanceof Date && filter.gt instanceof Date && actual > filter.gt;
      if ("lte" in filter) return actual instanceof Date && filter.lte instanceof Date && actual <= filter.lte;
      if ("in" in filter) return Array.isArray(filter.in) && filter.in.includes(actual);
    }
    return actual === expected;
  });
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    conversationId: "conversation-1",
    businessId: scope.businessId,
    kind: prepared.kind,
    payload: prepared.payload,
    snapshot: prepared.snapshot,
    summary,
    status: "PENDING",
    result: null,
    approvedAt: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  state = {
    conversation: {
      id: "conversation-1", ...scope, memoryVersion: 1,
      editingActionId: null, clarification: null, lastActiveAt: now,
    },
    actions: [],
  };

  mocked.$transaction.mockImplementation(async (work) => {
    const prior = structuredClone(state);
    try { return await work(mocked); }
    catch (caught) { state = prior; throw caught; }
  });
  mocked.assistantConversation.findFirst.mockImplementation(async ({ where }) =>
    matches(state.conversation, where) ? structuredClone(state.conversation) : null);
  mocked.assistantConversation.updateMany.mockImplementation(async ({ where, data }) => {
    if (!matches(state.conversation, where)) return { count: 0 };
    Object.assign(state.conversation, data);
    return { count: 1 };
  });
  mocked.assistantConversation.update.mockImplementation(async ({ data }) => Object.assign(state.conversation, data));
  mocked.assistantAction.findFirst.mockImplementation(async ({ where }) =>
    state.actions.find((row) => matches(row, where)) ?? null);
  mocked.assistantAction.findUniqueOrThrow.mockImplementation(async ({ where }) => {
    const found = state.actions.find((row) => row.id === where.id);
    if (!found) throw new Error("NOT_FOUND");
    return structuredClone(found);
  });
  mocked.assistantAction.updateMany.mockImplementation(async ({ where, data }) => {
    const found = state.actions.filter((row) => matches(row, where));
    found.forEach((row) => Object.assign(row, data));
    return { count: found.length };
  });
  mocked.assistantAction.update.mockImplementation(async ({ where, data }) => {
    const found = state.actions.find((row) => row.id === where.id);
    if (!found) throw new Error("NOT_FOUND");
    Object.assign(found, data);
    return structuredClone(found);
  });

  vi.mocked(assistantConfig).mockReturnValue({
    enabled: true, available: true, dailyLimit: 100, model: "offline", transcribeModel: "whisper-1",
  });
  vi.mocked(resolveDraft).mockResolvedValue(prepared);
  vi.mocked(renderSummary).mockReturnValue(summary);
  vi.mocked(executeAction).mockResolvedValue({ result, effects });
  vi.mocked(finalizeEffects).mockResolvedValue(undefined);
  vi.mocked(recordApprovalUsage).mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("approveAction", () => {
  it("returns a stored success without executing again", async () => {
    state.actions.push(action({ status: "APPROVED", result }));
    const reply = await approveAction(scope, "draft-1", now);
    expect(reply).toEqual({
      status: "already_done",
      reply: "Already done. Customer Amaka created.",
      result,
      draft: null,
    });
    expect(executeAction).not.toHaveBeenCalled();
    expect(finalizeEffects).not.toHaveBeenCalled();
    expect(recordApprovalUsage).toHaveBeenCalledWith(scope, "draft-1", expect.any(Date), "approved");
  });

  it("claims, revalidates, executes and saves the result before finalizing effects", async () => {
    state.actions.push(action());
    const reply = await approveAction(scope, "draft-1", now);

    expect(reply).toEqual({ status: "approved", reply: result.text, result, draft: null });
    expect(state.actions[0]).toMatchObject({ status: "APPROVED", result, approvedAt: now });
    expect(resolveDraft).toHaveBeenCalledWith(mocked, scope, originalRequest, {
      text: "Add customer Amaka", recentOwnerTexts: [], selectedIds: [],
    }, now);
    expect(executeAction).toHaveBeenCalledWith(mocked, scope, prepared, now);
    expect(finalizeEffects).toHaveBeenCalledWith(effects);
  });

  it("executes once across a replay and never repeats effects", async () => {
    state.actions.push(action());
    const first = await approveAction(scope, "draft-1", now);
    const second = await approveAction(scope, "draft-1", new Date(now.getTime() + 1_000));

    expect(first.status).toBe("approved");
    expect(second.status).toBe("already_done");
    expect(executeAction).toHaveBeenCalledTimes(1);
    expect(finalizeEffects).toHaveBeenCalledTimes(1);
  });

  it("commits INVALID without executing when the material payload changed", async () => {
    state.actions.push(action());
    vi.mocked(resolveDraft).mockResolvedValue({
      ...prepared,
      payload: { ...prepared.payload, name: "Tolu" },
    });

    const reply = await approveAction(scope, "draft-1", now);
    expect(reply.status).toBe("changed");
    expect(reply.reply).toContain("The shop's details changed since this draft was made.");
    expect(state.actions[0]).toMatchObject({ status: "INVALID", approvedAt: null });
    expect(executeAction).not.toHaveBeenCalled();
    expect(finalizeEffects).not.toHaveBeenCalled();
  });

  it("never executes an approved price after the catalog price changed", async () => {
    state.actions.push(action());
    vi.mocked(resolveDraft).mockResolvedValue({
      ...prepared,
      payload: { ...prepared.payload, priceMinor: 750000 },
    });

    const reply = await approveAction(scope, "draft-1", now);
    expect(reply.status).toBe("changed");
    expect(state.actions[0]!.status).toBe("INVALID");
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("invalidates the draft when a displayed stock consequence changed", async () => {
    state.actions.push(action());
    vi.mocked(renderSummary).mockReturnValue("Create customer Amaka?\nAvailable stock · Shea butter: 10 → 6.");

    const reply = await approveAction(scope, "draft-1", now);
    expect(reply.status).toBe("changed");
    expect(state.actions[0]!.status).toBe("INVALID");
    expect(executeAction).not.toHaveBeenCalled();
  });

  it.each([
    ["invoiceStatus", "SENT", "OVERDUE"],
    ["currentPhone", "+2348031234567", "+2348037654321"],
    ["catalogLines", [{ catalogPriceMinor: 500000 }], [{ catalogPriceMinor: 600000 }]],
  ])("invalidates changed material %s even when payload and summary stay identical", async (key, before, after) => {
    state.actions.push(action({ snapshot: { ...prepared.snapshot, [key]: before } }));
    vi.mocked(resolveDraft).mockResolvedValue({ ...prepared, snapshot: { ...prepared.snapshot, [key]: after } });
    expect((await approveAction(scope, "draft-1", now)).status).toBe("changed");
    expect(state.actions[0]!.status).toBe("INVALID");
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("ignores timestamp-only changes during material revalidation", async () => {
    state.actions.push(action({ snapshot: { ...prepared.snapshot, updatedAt: now.toISOString() } }));
    vi.mocked(resolveDraft).mockResolvedValue({ ...prepared, snapshot: { ...prepared.snapshot, updatedAt: new Date(now.getTime() + 1000).toISOString() } });
    expect((await approveAction(scope, "draft-1", now)).status).toBe("approved");
  });

  it("surfaces a changed invoice status as INVALID with the safe domain explanation", async () => {
    state.actions.push(action());
    vi.mocked(resolveDraft).mockRejectedValue(new BadRequestException("This invoice cannot record further payments"));

    const reply = await approveAction(scope, "draft-1", now);
    expect(reply).toEqual({
      status: "changed",
      reply: "I didn't apply this draft. This invoice cannot record further payments Nothing was changed. Ask Sara again for a fresh preview.",
      result: null,
      draft: null,
    });
    expect(state.actions[0]!.status).toBe("INVALID");
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("turns a clarification into a durable INVALID result and keeps its question", async () => {
    state.actions.push(action());
    vi.mocked(resolveDraft).mockResolvedValue({
      question: "A matching customer already exists. Which customer should I use?",
      choices: [{ id: "customer-2", label: "Amaka · 0803" }],
      originalRequest,
    });

    const reply = await approveAction(scope, "draft-1", now);
    expect(reply.status).toBe("changed");
    expect(reply.reply).toContain("Which customer should I use?");
    expect(state.actions[0]!.status).toBe("INVALID");
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("expires a pending action using time measured after the lock", async () => {
    state.actions.push(action({ expiresAt: new Date(now.getTime() - 1) }));
    const reply = await approveAction(scope, "draft-1", now);
    expect(reply.status).toBe("expired");
    expect(state.actions[0]!.status).toBe("EXPIRED");
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("cannot approve a replaced draft when a newer draft is pending", async () => {
    state.actions.push(
      action({ id: "draft-old", status: "REPLACED" }),
      action({ id: "draft-new" }),
    );
    const reply = await approveAction(scope, "draft-old", now);
    expect(reply.status).toBe("expired");
    expect(state.actions.map((row) => row.status)).toEqual(["REPLACED", "PENDING"]);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it.each(["channel", "principal"] as const)("rejects a draft from another %s", async (field) => {
    state.actions.push(action());
    const wrong = field === "channel"
      ? { ...scope, channel: "INSTAGRAM" as const }
      : { ...scope, principalId: "owner-2" };
    await expect(approveAction(wrong, "draft-1", now)).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("rejects an editing preview before claiming it", async () => {
    state.actions.push(action());
    state.conversation.editingActionId = "draft-1";
    await expect(approveAction(scope, "draft-1", now)).rejects.toMatchObject({ code: "ASSISTANT_DRAFT_EDITING" });
    expect(state.actions[0]!.status).toBe("PENDING");
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("rolls the claim back when the domain write fails", async () => {
    state.actions.push(action());
    vi.mocked(executeAction).mockRejectedValue(new BadRequestException("The stock is gone"));
    await expect(approveAction(scope, "draft-1", now)).rejects.toThrow("The stock is gone");
    expect(state.actions[0]).toMatchObject({ status: "PENDING", approvedAt: null, result: null });
    expect(finalizeEffects).not.toHaveBeenCalled();
  });

  it("returns the saved result even when effect delivery fails", async () => {
    state.actions.push(action());
    vi.mocked(finalizeEffects).mockRejectedValue(new Error("pdf unavailable"));
    const reply = await approveAction(scope, "draft-1", now);
    expect(reply.status).toBe("approved");
    expect(state.actions[0]!.status).toBe("APPROVED");
  });

  it("returns the saved result even when approval usage logging fails", async () => {
    state.actions.push(action());
    vi.mocked(recordApprovalUsage).mockRejectedValue(new Error("usage unavailable"));
    const reply = await approveAction(scope, "draft-1", now);
    expect(reply.status).toBe("approved");
    expect(reply.result).toEqual(result);
  });

  it("refuses before touching the store when the assistant is unavailable", async () => {
    vi.mocked(assistantConfig).mockReturnValue({
      enabled: false, available: false, dailyLimit: 100, model: "offline", transcribeModel: "whisper-1",
    });
    await expect(approveAction(scope, "draft-1", now)).rejects.toMatchObject({ code: "ASSISTANT_UNAVAILABLE" });
    expect(mocked.assistantAction.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ["CANCELLED", "cancelled"],
    ["EXPIRED", "expired"],
    ["INVALID", "changed"],
  ] as const)("maps an existing %s action to %s without executing", async (status, expected) => {
    state.actions.push(action({ status }));
    const reply = await approveAction(scope, "draft-1", now);
    expect(reply.status).toBe(expected);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("does not trust a malformed saved result and never executes again", async () => {
    state.actions.push(action({ status: "APPROVED", result: { text: 42 } }));
    await expect(approveAction(scope, "draft-1", now)).rejects.toMatchObject({ code: "ASSISTANT_ACTION_RESULT_MISSING" });
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("returns an already-done result when another approval won the claim", async () => {
    state.actions.push(action());
    const updateMany = mocked.assistantAction.updateMany.getMockImplementation();
    mocked.assistantAction.updateMany.mockImplementationOnce(async (args) => {
      if (args.data.status === "APPROVED") {
        state.actions[0] = action({ status: "APPROVED", result, approvedAt: now });
        return { count: 0 };
      }
      if (!updateMany) throw new Error("Mock implementation missing");
      return updateMany(args);
    });

    const reply = await approveAction(scope, "draft-1", now);
    expect(reply.status).toBe("already_done");
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("returns cancelled when a cancellation won the claim", async () => {
    state.actions.push(action());
    const updateMany = mocked.assistantAction.updateMany.getMockImplementation();
    mocked.assistantAction.updateMany.mockImplementationOnce(async (args) => {
      if (args.data.status === "APPROVED") {
        state.actions[0] = action({ status: "CANCELLED" });
        return { count: 0 };
      }
      if (!updateMany) throw new Error("Mock implementation missing");
      return updateMany(args);
    });

    const reply = await approveAction(scope, "draft-1", now);
    expect(reply.status).toBe("cancelled");
    expect(executeAction).not.toHaveBeenCalled();
  });
});

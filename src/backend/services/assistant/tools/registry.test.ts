import type { ResponsesTransport } from "../loop";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("./reads", () => ({ executeRead: vi.fn() }));
vi.mock("../actions/resolve", () => ({ resolveDraft: vi.fn() }));
vi.mock("../actions/drafts", () => ({ createDraft: vi.fn() }));
vi.mock("../store", () => ({ saveClarification: vi.fn() }));
import { executeRead } from "./reads";
import { resolveDraft } from "../actions/resolve";
import { createDraft } from "../actions/drafts";
import { saveClarification } from "../store";
import { buildTools, dispatchTool, registry, type ToolContext } from "./registry";
const context: ToolContext = {
  scope: { businessId: "biz_1", channel: "WHATSAPP", principalId: "i1" },
  conversationId: "c1", memoryVersion: 0, leaseToken: "token",
  evidence: { text: "Create customer Ada", recentOwnerTexts: [], selectedIds: [] },
  now: new Date(), signal: new AbortController().signal,
};
const request = { kind: "create_customer" as const, name: "Ada", phone: null, email: null, address: null, notes: null };
beforeEach(() => vi.clearAllMocks());
describe("curated registry", () => {
  it("returns unknown-tool errors without calling a service", async () => {
    expect(await dispatchTool(context, "execute_sql", '{"query":"delete from invoice"}')).toMatchObject({ kind: "error", code: "UNKNOWN_TOOL" });
    expect(executeRead).not.toHaveBeenCalled(); expect(resolveDraft).not.toHaveBeenCalled();
  });
  it("publishes exactly nine reads and thirteen draft object schemas compatible with strict tools", () => {
    expect(registry.filter((entry) => entry.access === "read")).toHaveLength(9);
    expect(registry.filter((entry) => entry.access === "draft")).toHaveLength(13);
    const check = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(check); return; }
      const node = value as Record<string, unknown>;
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect(new Set(node.required as string[])).toEqual(new Set(Object.keys(node.properties as object)));
      }
      Object.values(node).forEach(check);
    };
    for (const tool of buildTools()) {
      expect(tool.strict).toBe(true); expect(tool.parameters?.type).toBe("object");
      expect(tool.parameters).not.toHaveProperty("$schema"); check(tool.parameters);
      expect(tool.name).not.toMatch(/approve|execute|sql|http|settings/);
    }
  });
  it("rejects malformed JSON and incorrect variants without service access", async () => {
    expect(await dispatchTool(context, "orders_to_send", "{")).toMatchObject({ code: "INVALID_JSON" });
    expect(await dispatchTool(context, "orders_to_send", '{"name":"business_summary"}')).toMatchObject({ code: "INVALID_ARGUMENTS" });
    expect(executeRead).not.toHaveBeenCalled();
  });
  it("resolves a preview then publishes only the immutable draft", async () => {
    const prepared = { kind: "create_customer" as const, payload: {}, snapshot: {} };
    const draft = { id: "d1", summary: "Create customer Ada?", status: "PENDING" as const, expiresAt: "2026-11-06" };
    vi.mocked(resolveDraft).mockResolvedValue(prepared); vi.mocked(createDraft).mockResolvedValue(draft);
    expect(await dispatchTool(context, "draft_create_customer", JSON.stringify(request))).toEqual({ kind: "draft", draft });
    expect(createDraft).toHaveBeenCalledWith(context.scope, prepared, 0, context.now, { conversationId: "c1", leaseToken: "token", signal: context.signal });
  });
  it("stores trusted clarification and stops before draft publication", async () => {
    const clarification = { question: "Which Ada?", choices: [{ id: "c2", label: "Ada · 0801" }], originalRequest: request };
    vi.mocked(resolveDraft).mockResolvedValue(clarification);
    expect(await dispatchTool(context, "draft_create_customer", JSON.stringify(request))).toMatchObject({ kind: "clarification" });
    expect(saveClarification).toHaveBeenCalledWith(context.scope, expect.objectContaining({ leaseToken: "token" }), clarification, context.evidence, context.signal);
    expect(createDraft).not.toHaveBeenCalled();
  });
  it("does not publish a resolution arriving after cancellation", async () => {
    const controller = new AbortController();
    vi.mocked(resolveDraft).mockImplementation(async () => { controller.abort(); return { kind: "create_customer", payload: {}, snapshot: {} }; });
    await expect(dispatchTool({ ...context, signal: controller.signal }, "draft_create_customer", JSON.stringify(request))).rejects.toThrow();
    expect(createDraft).not.toHaveBeenCalled();
  });
});

describe("safe validation and continuation fences", () => {
  it.each([
    [{ kind: "record_invoice_payment", invoiceId: "i1", amount: null, method: "CASH", createReceipt: false }, "amount"],
    [{ kind: "record_invoice_payment", invoiceId: "i1", amount: { amountMinor: 100, quote: "paid 100" }, method: null, createReceipt: false }, "cash or bank transfer"],
  ])("returns a focused code-written question for invalid request %o", async (args, expected) => {
    // Both variants deliberately include an invalid field; no resolver/provider is called.
    const outcome = await dispatchTool(context, "draft_record_invoice_payment", JSON.stringify(args));
    expect(outcome).toMatchObject({ kind: "error", code: "INVALID_ARGUMENTS" });
    if (outcome.kind === "error") expect(outcome.question?.toLowerCase()).toContain(expected);
    expect(resolveDraft).not.toHaveBeenCalled();
  });
  it("maps only exact known domain failures to safe questions", async () => {
    vi.mocked(resolveDraft).mockRejectedValue(new Error("Please state the receipt amount"));
    expect(await dispatchTool(context, "draft_create_customer", JSON.stringify(request))).toMatchObject({ kind: "error", question: "How much was paid?" });
    vi.mocked(resolveDraft).mockRejectedValue(new Error("private account body sk-secret"));
    const unknown = await dispatchTool(context, "draft_create_customer", JSON.stringify(request));
    expect(JSON.stringify(unknown)).not.toContain("sk-secret");
  });
  it("rejects unrelated previews while the original request needs clarification", async () => {
    const outcome = await dispatchTool({ ...context, pendingClarification: { originalRequest: request } }, "draft_adjust_stock", "{}");
    expect(outcome).toMatchObject({ code: "CLARIFICATION_PENDING" }); expect(resolveDraft).not.toHaveBeenCalled();
  });
  it("checks the server-owned current generation before any service dispatch", async () => {
    const checkCurrent = vi.fn().mockRejectedValue(new Error("ASSISTANT_TURN_STALE"));
    await expect(dispatchTool({ ...context, checkCurrent }, "orders_to_send", '{"name":"orders_to_send"}')).rejects.toThrow("ASSISTANT_TURN_STALE");
    expect(executeRead).not.toHaveBeenCalled(); expect(resolveDraft).not.toHaveBeenCalled();
  });
  it("does not repeat an unchanged duplicate create after selecting the existing record", async () => {
    const outcome = await dispatchTool({ ...context, pendingClarification: { originalRequest: request, existingSelection: { id: "c2", label: "Ada" } } }, "draft_create_customer", JSON.stringify(request));
    expect(outcome).toMatchObject({ code: "NEW_NAME_REQUIRED" }); expect(resolveDraft).not.toHaveBeenCalled();
  });
});

describe("offline full request continuation", () => {
  it.each(["PICKUP", "DELIVERY"])("retains the original receipt while resolving the free-text %s answer", async (fulfilment) => {
    const { runModelTurn } = await import("../loop");
    const { UsageAccumulator } = await import("../usage");
    const originalRequest = { kind: "create_receipt" as const, customer: null,
      lines: [{ kind: "product" as const, id: "option-owned", name: null, quantity: 2, priceOverride: null }], amount: null,
      method: "CASH" as const, fulfilment: null, deliveryAddress: null, notes: "Keep original notes" };
    const answer = fulfilment === "PICKUP" ? "pickup" : "delivery to 24 Lagos Road";
    const completed = { ...originalRequest, fulfilment, deliveryAddress: fulfilment === "DELIVERY" ? "24 Lagos Road" : null };
    const draft = { id: "d1", summary: "Preview exact saved receipt", status: "PENDING" as const, expiresAt: "2026-11-06" };
    vi.mocked(resolveDraft).mockResolvedValue({ kind: "create_receipt", payload: {}, snapshot: {} });
    vi.mocked(createDraft).mockResolvedValue(draft);
    const transport = vi.fn<ResponsesTransport>().mockImplementation(async (params) => {
      expect(JSON.stringify(params.input)).toContain("option-owned");
      expect(JSON.stringify(params.input)).toContain("Keep original notes");
      expect(JSON.stringify(params.input)).toContain(answer);
      return { output: [{ type: "function_call", name: "draft_create_receipt", call_id: "continue", arguments: JSON.stringify(completed) }], usage: null };
    });
    const clarification = { originalRequest, question: "Pickup or delivery?", choices: [], evidence: context.evidence, createdAt: new Date().toISOString() };
    const result = await runModelTurn({ context: { ...context, pendingClarification: clarification }, text: answer,
      clarification, business: { name: "Shop", currency: "NGN", sells: "PRODUCTS" }, usage: new UsageAccumulator(), transport, dispatch: dispatchTool });
    expect(result.draft).toEqual(draft);
    expect(resolveDraft).toHaveBeenCalledWith(expect.anything(), context.scope, completed, context.evidence, context.now);
  });
});

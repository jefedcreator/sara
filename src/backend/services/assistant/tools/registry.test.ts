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
const request = { kind: "create_customer", name: "Ada", phone: null, email: null, address: null, notes: null };
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

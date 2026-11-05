import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/db", () => ({ db: { business: { findFirst: vi.fn() } } }));
vi.mock("./store", () => ({ assertTurnCurrent: vi.fn(), saveReadPages: vi.fn(), saveClarification: vi.fn(), hasPendingReadPage: vi.fn(), claimTurnLease: vi.fn(), getConversation: vi.fn(), releaseTurn: vi.fn(), saveTurn: vi.fn(), loadRecent: vi.fn(), loadTurnMemory: vi.fn(), selectClarification: vi.fn(), hasPendingClarification: vi.fn(), hasEditingContext: vi.fn(), INTERRUPTED_TURN_REPLY: "Interrupted" }));
vi.mock("./config", () => ({ assistantConfig: vi.fn(), TURN_TIMEOUT_MS: 25_000 }));
vi.mock("./audio", () => ({ transcribeAudio: vi.fn(), transcriptPrefix: (text: string) => `🎙️ "${text}"\n\n`, AudioError: class AudioError extends Error {} }));
vi.mock("./usage", async (original) => ({ ...await original<typeof import("./usage")>(), reserveUsage: vi.fn(), finishUsage: vi.fn() }));
vi.mock("./loop", async (original) => ({ ...await original<typeof import("./loop")>(), runModelTurn: vi.fn() }));
vi.mock("./tools/registry", () => ({ dispatchTool: vi.fn(), buildTools: vi.fn() }));
vi.mock("./openai", () => ({ getOpenAI: vi.fn(() => { throw new Error("No paid calls"); }) }));
import { db } from "@/server/db";
import { assistantService, AssistantBusyError, AssistantTimeoutError, continuationEvidence, type AssistantMessageInput } from "./index";
import { assistantConfig } from "./config";
import { claimTurnLease, loadRecent, loadTurnMemory, releaseTurn, saveTurn, assertTurnCurrent, saveReadPages, saveClarification, selectClarification } from "./store";
import { reserveUsage, finishUsage } from "./usage";
import { runModelTurn } from "./loop";
import { transcribeAudio } from "./audio";
import { verifyOwnerPrice } from "./actions/amount";
const claim = { status: "claimed" as const, conversationId: "c1", leaseToken: "lease1", memoryVersion: 2 };
const input: AssistantMessageInput = { scope: { businessId: "b1", principalId: "p1", channel: "WEB" }, requestId: "req1", input: { kind: "text", text: "sales today" } };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  vi.mocked(claimTurnLease).mockResolvedValue(claim);
  vi.mocked(assistantConfig).mockReturnValue({ enabled: true, available: true, dailyLimit: 100, model: "offline", transcribeModel: "whisper-1" });
  vi.mocked(reserveUsage).mockResolvedValue({ id: "usage1", fresh: true });
  vi.mocked(saveTurn).mockResolvedValue(undefined);
  vi.mocked(finishUsage).mockResolvedValue(undefined);
  vi.mocked(releaseTurn).mockResolvedValue(undefined);
  vi.mocked(assertTurnCurrent).mockResolvedValue(undefined);
  vi.mocked(saveReadPages).mockResolvedValue(undefined);
  vi.mocked(saveClarification).mockResolvedValue(undefined);
  vi.mocked(loadRecent).mockResolvedValue([]);
  vi.mocked(loadTurnMemory).mockResolvedValue({ clarification: null, editing: null });
  vi.mocked(db.business.findFirst).mockResolvedValue({ name: "Shop", currency: "NGN", sells: "BOTH" } as Awaited<ReturnType<typeof db.business.findFirst>>);
  vi.mocked(runModelTurn).mockResolvedValue({ reply: "No sales today.", draft: null, toolRecords: [] });
});
afterEach(() => vi.useRealTimers());
describe("assistant service lifecycle", () => {
  it("replays DONE without reservation, SDK work or rewriting the turn", async () => {
    const replay = { conversationId: "c1", requestId: "req1", transcript: null, reply: "saved", draft: null, result: null };
    vi.mocked(claimTurnLease).mockResolvedValue(replay);
    expect(await assistantService.message(input)).toEqual(replay);
    expect(reserveUsage).not.toHaveBeenCalled(); expect(runModelTurn).not.toHaveBeenCalled(); expect(saveTurn).not.toHaveBeenCalled();
  });
  it("exposes a typed busy error", async () => {
    vi.mocked(claimTurnLease).mockResolvedValue("busy");
    await expect(assistantService.message(input)).rejects.toBeInstanceOf(AssistantBusyError);
    expect(reserveUsage).not.toHaveBeenCalled();
  });
  it.each(["unavailable", "quota", "orphan"])("does no paid work for %s", async (condition) => {
    if (condition === "unavailable") vi.mocked(assistantConfig).mockReturnValue({ enabled: false, available: false, dailyLimit: 100, model: "offline", transcribeModel: "whisper-1" });
    if (condition === "quota") vi.mocked(reserveUsage).mockResolvedValue(null);
    if (condition === "orphan") vi.mocked(reserveUsage).mockResolvedValue({ id: "usage1", fresh: false });
    const load = vi.fn();
    await assistantService.message({ ...input, input: { kind: "audio", load } });
    expect(load).not.toHaveBeenCalled(); expect(transcribeAudio).not.toHaveBeenCalled(); expect(runModelTurn).not.toHaveBeenCalled(); expect(finishUsage).not.toHaveBeenCalled();
    expect(saveTurn).toHaveBeenCalledWith(input.scope, "req1", expect.objectContaining({ state: "DONE" }), expect.any(AbortSignal));
    expect(releaseTurn).toHaveBeenCalledWith(input.scope, "req1", "lease1");
  });
  it("persists transcript before interpretation and retains it on a model failure", async () => {
    vi.mocked(transcribeAudio).mockResolvedValue({ text: "Sales today", seconds: 12, providerRequestId: "audio1" });
    vi.mocked(runModelTurn).mockRejectedValue(new Error("timeout"));
    const reply = await assistantService.message({ ...input, input: { kind: "audio", load: vi.fn() } });
    expect(saveTurn).toHaveBeenNthCalledWith(1, input.scope, "req1", expect.objectContaining({ state: "RUNNING", transcript: "Sales today" }), expect.any(AbortSignal));
    expect(reply.transcript).toBe("Sales today");
    expect(reply.reply).not.toContain("🎙️");
    expect(finishUsage).toHaveBeenCalledWith("usage1", expect.objectContaining({ audioSeconds: 12, providerRequestIds: ["audio1"], outcome: "error" }));
  });
  it("sends progress at four seconds, tolerates its failure and clears timers", async () => {
    let complete!: (value: Awaited<ReturnType<typeof runModelTurn>>) => void;
    vi.mocked(runModelTurn).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const onProgress = vi.fn().mockRejectedValue(new Error("delivery failed"));
    const pending = assistantService.message({ ...input, onProgress });
    await vi.advanceTimersByTimeAsync(3_999); expect(onProgress).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(onProgress).toHaveBeenCalledTimes(1);
    complete({ reply: "Done reading.", draft: null, toolRecords: [] }); await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts once at 25 seconds and saves a replayable fallback with known usage", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(runModelTurn).mockImplementation(async ({ context, usage }) => {
      signal = context.signal; usage.inputTokens = 30;
      return new Promise((_resolve, reject) => context.signal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true }));
    });
    const pending = assistantService.message(input);
    await vi.advanceTimersByTimeAsync(25_000); await pending;
    expect(signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    expect(finishUsage).toHaveBeenCalledWith("usage1", expect.objectContaining({ inputTokens: 30, outcome: "error", billingUnknown: true }));
    expect(saveTurn).toHaveBeenCalledWith(input.scope, "req1", expect.objectContaining({ state: "DONE" }), expect.any(AbortSignal));
  });
  it("releases the exact lease even when usage finalization fails", async () => {
    vi.mocked(finishUsage).mockRejectedValue(new Error("db unavailable"));
    await assistantService.message(input);
    expect(releaseTurn).toHaveBeenCalledWith(input.scope, "req1", "lease1"); expect(vi.getTimerCount()).toBe(0);
  });
});

describe("review regressions", () => {
  it("bounds initial lock waiting and exposes a typed timeout without a fabricated conversation", async () => {
    vi.mocked(claimTurnLease).mockImplementation(() => new Promise(() => undefined));
    const pending = assistantService.message(input);
    const rejected = expect(pending).rejects.toBeInstanceOf(AssistantTimeoutError);
    await vi.advanceTimersByTimeAsync(25_000); await rejected;
    expect(saveTurn).not.toHaveBeenCalled(); expect(reserveUsage).not.toHaveBeenCalled();
  });
  it.each(["reserve", "transcript", "final-save", "usage", "release"])("bounds deferred %s and independently attempts cleanup", async (phase) => {
    const never = () => new Promise<never>(() => undefined);
    if (phase === "reserve") vi.mocked(reserveUsage).mockImplementation(never);
    if (phase === "transcript") {
      vi.mocked(transcribeAudio).mockResolvedValue({ text: "Sales today", seconds: 1 });
      vi.mocked(saveTurn).mockImplementationOnce(never);
    }
    if (phase === "final-save") vi.mocked(saveTurn).mockImplementation(never);
    if (phase === "usage") vi.mocked(finishUsage).mockImplementation(never);
    if (phase === "release") vi.mocked(releaseTurn).mockImplementation(never);
    const pending = assistantService.message(phase === "transcript" ? { ...input, input: { kind: "audio", load: vi.fn() } } : input);
    await vi.advanceTimersByTimeAsync(26_000);
    await pending;
    expect(releaseTurn).toHaveBeenCalledWith(input.scope, input.requestId, claim.leaseToken);
    expect(vi.getTimerCount()).toBe(0);
    if (phase === "transcript" || phase === "reserve") expect(runModelTurn).not.toHaveBeenCalled();
  });
  it("retains the original explicit price evidence with full overlapping edit histories", async () => {
    const previous = Array.from({ length: 12 }, (_, index) => `old turn ${index}`);
    const history = Array.from({ length: 12 }, (_, index) => ({ userText: `new turn ${index}`, transcript: null, reply: "ok", toolRecords: [], createdAt: new Date() }));
    const original = { text: "Invoice Ada at NGN 45,000 each", recentOwnerTexts: previous, selectedIds: [] };
    const evidence = continuationEvidence("Change the due date to tomorrow", original, history);
    expect(evidence.recentOwnerTexts).toContain(original.text);
    expect(verifyOwnerPrice({ quote: "NGN 45,000", amountMinor: 4_500_000 }, evidence)).toBe(4_500_000);
    expect(evidence.recentOwnerTexts).toHaveLength(24);
    expect(evidence.text).toBe("Change the due date to tomorrow");
    const numbered = continuationEvidence("1", original, history);
    expect(numbered.text).toBe("1"); expect(numbered.selectedIds).toEqual([]);
    expect(() => verifyOwnerPrice({ quote: "1", amountMinor: 100 }, numbered)).toThrow();
  });
  it.each(["pickup", "24 Lagos Road", "Ada 08012345678"])("passes the complete saved clarification and answer %s to continuation", async (answer) => {
    const originalRequest = { kind: "create_customer" as const, name: "Ada", phone: null, email: null, address: null, notes: null };
    const clarification = { question: "Which details?", choices: [], originalRequest,
      evidence: { text: "Create customer Ada", recentOwnerTexts: [], selectedIds: [] }, createdAt: new Date().toISOString() };
    vi.mocked(loadTurnMemory).mockResolvedValue({ clarification, editing: null });
    await assistantService.message({ ...input, input: { kind: "text", text: answer } });
    expect(runModelTurn).toHaveBeenCalledWith(expect.objectContaining({ text: answer, clarification,
      context: expect.objectContaining({ pendingClarification: clarification, evidence: expect.objectContaining({ text: answer, recentOwnerTexts: ["Create customer Ada"] }) }) }));
  });
  it.each(["create_customer", "create_product", "create_service"])("turns a duplicate %s selection into an explicit update-or-new-name decision", async (kind) => {
    // The stored schema/resolver tests validate the full shape; this runner must not retry the create tool.
    const request = { kind, name: "Ada" } as Parameters<typeof selectClarification>[0]["originalRequest"];
    const evidence = { text: "Create Ada", recentOwnerTexts: [], selectedIds: ["existing"] };
    const clarification = { question: "Already exists", choices: [{ id: "existing", label: "Ada" }], originalRequest: request,
      evidence, createdAt: new Date().toISOString() };
    vi.mocked(loadTurnMemory).mockResolvedValue({ clarification, editing: null });
    vi.mocked(selectClarification).mockReturnValue({ request, evidence, selected: clarification.choices[0]! });
    const reply = await assistantService.message({ ...input, input: { kind: "text", text: "1" } });
    expect(reply.reply).toContain("Tell me what to update");
    expect(saveClarification).toHaveBeenCalledWith(input.scope, claim, expect.objectContaining({ choices: [], originalRequest: request }), evidence, expect.any(AbortSignal), { id: "existing", label: "Ada" });
    expect(runModelTurn).not.toHaveBeenCalled();
  });
  it("serves exact subsequent report pages without quota or model work", async () => {
    vi.mocked(loadTurnMemory).mockResolvedValue({ clarification: null, editing: null,
      readPages: { kind: "read_pages", pages: ["First fact\n", "Last fact: NGN 100."], next: 1, createdAt: new Date().toISOString() } });
    const reply = await assistantService.message({ ...input, input: { kind: "text", text: "next" } });
    expect(reply.reply).toContain("Last fact: NGN 100.");
    expect(saveReadPages).toHaveBeenCalledWith(input.scope, claim, ["First fact\n", "Last fact: NGN 100."], 2, expect.any(AbortSignal));
    expect(reserveUsage).not.toHaveBeenCalled(); expect(runModelTurn).not.toHaveBeenCalled();
  });
  it("blocks paid interpretation after a reset during the guarded pipeline", async () => {
    vi.mocked(assertTurnCurrent).mockRejectedValue(Object.assign(new Error("stale"), { code: "ASSISTANT_TURN_STALE" }));
    await assistantService.message(input);
    expect(runModelTurn).not.toHaveBeenCalled(); expect(transcribeAudio).not.toHaveBeenCalled();
    expect(releaseTurn).toHaveBeenCalledWith(input.scope, input.requestId, claim.leaseToken);
  });
});

describe("canonical voice DTO to channel presentation", () => {
  it.each(["read", "draft", "clarification", "error"])("adds the transcript exactly once for %s and duplicate replay", async (kind) => {
    const { presentAssistantReply } = await import("../messaging/assistant");
    vi.mocked(transcribeAudio).mockResolvedValue({ text: "Sales today", seconds: 1 });
    if (kind === "draft") vi.mocked(runModelTurn).mockResolvedValue({ reply: "Create invoice?", draft: { id: "draft-1", summary: "Create invoice?", status: "PENDING", expiresAt: "2026-11-06" }, toolRecords: [] });
    if (kind === "clarification") vi.mocked(runModelTurn).mockResolvedValue({ reply: "Which customer?\n1. Ada", draft: null, toolRecords: [] });
    if (kind === "error") vi.mocked(runModelTurn).mockRejectedValue(new Error("offline failure"));
    const dto = await assistantService.message({ ...input, input: { kind: "audio", load: vi.fn() } });
    expect(dto.reply).not.toContain("🎙️"); expect(dto.transcript).toBe("Sales today");
    expect(presentAssistantReply("WEB", dto).text).not.toContain("🎙️");
    expect(presentAssistantReply("WHATSAPP", dto).text.match(/🎙️/g)).toHaveLength(1);
    vi.mocked(claimTurnLease).mockResolvedValue(dto);
    const replay = await assistantService.message(input);
    expect(replay).toEqual(dto);
    expect(presentAssistantReply("WHATSAPP", replay).text).toBe(presentAssistantReply("WHATSAPP", dto).text);
    expect(presentAssistantReply("WHATSAPP", replay).text.match(/🎙️/g)).toHaveLength(1);
  });
});

describe("progress callback lifetime", () => {
  it("awaits an in-flight progress delivery within the cleanup allowance", async () => {
    let finishModel!: (value: Awaited<ReturnType<typeof runModelTurn>>) => void;
    let finishProgress!: () => void;
    vi.mocked(runModelTurn).mockImplementation(() => new Promise((resolve) => { finishModel = resolve; }));
    const onProgress = vi.fn(() => new Promise<void>((resolve) => { finishProgress = resolve; }));
    let settled = false;
    const pending = assistantService.message({ ...input, onProgress }).then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(4_000);
    finishModel({ reply: "Read completed", draft: null, toolRecords: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    finishProgress(); await pending;
    expect(settled).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
});

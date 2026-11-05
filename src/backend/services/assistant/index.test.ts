import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/db", () => ({ db: { business: { findFirst: vi.fn() } } }));
vi.mock("./store", () => ({ claimTurnLease: vi.fn(), getConversation: vi.fn(), releaseTurn: vi.fn(), saveTurn: vi.fn(), loadRecent: vi.fn(), loadTurnMemory: vi.fn(), selectClarification: vi.fn(), hasPendingClarification: vi.fn(), hasEditingContext: vi.fn(), INTERRUPTED_TURN_REPLY: "Interrupted" }));
vi.mock("./config", () => ({ assistantConfig: vi.fn(), TURN_TIMEOUT_MS: 25_000 }));
vi.mock("./audio", () => ({ transcribeAudio: vi.fn(), transcriptPrefix: (text: string) => `🎙️ "${text}"\n\n`, AudioError: class AudioError extends Error {} }));
vi.mock("./usage", async (original) => ({ ...await original<typeof import("./usage")>(), reserveUsage: vi.fn(), finishUsage: vi.fn() }));
vi.mock("./loop", async (original) => ({ ...await original<typeof import("./loop")>(), runModelTurn: vi.fn() }));
vi.mock("./tools/registry", () => ({ dispatchTool: vi.fn(), buildTools: vi.fn() }));
vi.mock("./openai", () => ({ getOpenAI: vi.fn(() => { throw new Error("No paid calls"); }) }));
import { db } from "@/server/db";
import { assistantService, AssistantBusyError, type AssistantMessageInput } from "./index";
import { assistantConfig } from "./config";
import { claimTurnLease, loadRecent, loadTurnMemory, releaseTurn, saveTurn } from "./store";
import { reserveUsage, finishUsage } from "./usage";
import { runModelTurn } from "./loop";
import { transcribeAudio } from "./audio";
const claim = { status: "claimed" as const, conversationId: "c1", leaseToken: "lease1", memoryVersion: 2 };
const input: AssistantMessageInput = { scope: { businessId: "b1", principalId: "p1", channel: "WEB" }, requestId: "req1", input: { kind: "text", text: "sales today" } };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  vi.mocked(claimTurnLease).mockResolvedValue(claim);
  vi.mocked(assistantConfig).mockReturnValue({ enabled: true, available: true, dailyLimit: 100, model: "offline", transcribeModel: "whisper-1" });
  vi.mocked(reserveUsage).mockResolvedValue({ id: "usage1", fresh: true });
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
    expect(saveTurn).toHaveBeenCalledWith(input.scope, "req1", expect.objectContaining({ state: "DONE" }));
    expect(releaseTurn).toHaveBeenCalledWith(input.scope, "req1", "lease1");
  });
  it("persists transcript before interpretation and retains it on a model failure", async () => {
    vi.mocked(transcribeAudio).mockResolvedValue({ text: "Sales today", seconds: 12, providerRequestId: "audio1" });
    vi.mocked(runModelTurn).mockRejectedValue(new Error("timeout"));
    const reply = await assistantService.message({ ...input, input: { kind: "audio", load: vi.fn() } });
    expect(saveTurn).toHaveBeenNthCalledWith(1, input.scope, "req1", expect.objectContaining({ state: "RUNNING", transcript: "Sales today" }));
    expect(reply.reply).toContain('🎙️ "Sales today"');
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
    expect(saveTurn).toHaveBeenCalledWith(input.scope, "req1", expect.objectContaining({ state: "DONE" }));
  });
  it("releases the exact lease even when usage finalization fails", async () => {
    vi.mocked(finishUsage).mockRejectedValue(new Error("db unavailable"));
    await expect(assistantService.message(input)).rejects.toThrow("db unavailable");
    expect(releaseTurn).toHaveBeenCalledWith(input.scope, "req1", "lease1"); expect(vi.getTimerCount()).toBe(0);
  });
});

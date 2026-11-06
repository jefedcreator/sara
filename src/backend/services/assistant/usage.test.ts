import type { ResponseUsage } from "openai/resources/responses/responses";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const objectContaining = (value: unknown): unknown => expect.objectContaining(value);

const mockedEnv = vi.hoisted<{
  OPENAI_API_KEY?: string; OPENAI_ASSISTANT_MODEL: string;
  OPENAI_TRANSCRIBE_MODEL: string; ASSISTANT_ENABLED: boolean; ASSISTANT_DAILY_LIMIT: number;
}>(
  () =>
    ({
      OPENAI_API_KEY: "sk-test",
      OPENAI_ASSISTANT_MODEL: "gpt-5.4-mini",
      OPENAI_TRANSCRIBE_MODEL: "whisper-1",
      ASSISTANT_ENABLED: true,
      ASSISTANT_DAILY_LIMIT: 100,
    }),
);

vi.mock("@/env", () => ({ env: mockedEnv }));
const mockedDb = vi.hoisted(() => ({
  assistantUsage: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/server/db", () => ({ db: mockedDb }));
vi.mock("./store", () => ({ getConversation: vi.fn() }));


import { getConversation } from "./store";
import {
  estimateCost,
  finishUsage,
  PRICING_VERSION,
  recordApprovalUsage,
  reserveUsage,
  UsageAccumulator,
} from "./usage";
import type { AssistantScope } from "./types";

const mockedGetConversation = vi.mocked(getConversation);

const scope: AssistantScope = {
  businessId: "biz_1",
  channel: "WHATSAPP",
  principalId: "identity_1",
};

const now = new Date("2026-11-04T12:00:00Z");

const conversation = {
  id: "conv_1",
  businessId: "biz_1",
  channel: "WHATSAPP",
  principalId: "identity_1",
  lastActiveAt: now,
  memoryVersion: 0,
  clarification: null,
  editingActionId: null,
  leaseToken: null,
  leaseExpiresAt: null,
};

function transactionClient(options?: {
  createId?: string;
  dailyRows?: { count: number }[];
}) {
  return {
    assistantUsage: {
      create: vi.fn().mockResolvedValue({ id: options?.createId ?? "usage_1" }),
    },
    $queryRaw: vi.fn<(parts: TemplateStringsArray, ...values: unknown[]) => Promise<{ count: number }[]>>().mockResolvedValue(options?.dailyRows ?? [{ count: 1 }]),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedEnv.OPENAI_API_KEY = "sk-test";
  mockedEnv.OPENAI_ASSISTANT_MODEL = "gpt-5.4-mini";
  mockedEnv.OPENAI_TRANSCRIBE_MODEL = "whisper-1";
  mockedEnv.ASSISTANT_ENABLED = true;
  mockedEnv.ASSISTANT_DAILY_LIMIT = 100;
  mockedGetConversation.mockResolvedValue(conversation as never);
  mockedDb.assistantUsage.findUnique.mockResolvedValue(null);
  mockedDb.assistantUsage.update.mockResolvedValue({});
  mockedDb.assistantUsage.upsert.mockResolvedValue({});
  mockedDb.$transaction.mockImplementation(async (callback: (tx: ReturnType<typeof transactionClient>) => Promise<unknown>) =>
    callback(transactionClient()),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("estimateCost", () => {
  it("does not apply Whisper prices to an unknown transcription model", () => {
    expect(estimateCost({ model: "gpt-5.4-mini", input: 100, cached: 0, output: 20, audioSeconds: 30, transcribeModel: "future-transcribe" })).toEqual({ usd: null, pricingVersion: null });
  });
  it("does not charge cached tokens at the uncached rate", () => {
    const result = estimateCost({
      model: "gpt-5.4-mini",
      input: 1000,
      cached: 400,
      output: 100,
      audioSeconds: 0,
    });
    expect(result.usd).toBe("0.00093000");
    expect(result.pricingVersion).toBe(PRICING_VERSION);
  });

  it("charges Whisper by the minute", () => {
    expect(
      estimateCost({
        model: "whisper-1",
        input: 0,
        cached: 0,
        output: 0,
        audioSeconds: 90,
      }).usd,
    ).toBe("0.00900000");
  });

  it("returns null for an unknown configured model, never zero", () => {
    expect(
      estimateCost({
        model: "gpt-future",
        input: 1000,
        cached: 0,
        output: 100,
        audioSeconds: 0,
      }),
    ).toEqual({ usd: null, pricingVersion: null });
  });

  it("clamps cached tokens to the input total", () => {
    expect(
      estimateCost({
        model: "gpt-5.4-mini",
        input: 100,
        cached: 500,
        output: 0,
        audioSeconds: 0,
      }).usd,
    ).toBe("0.00000750");
  });
});

describe("reserveUsage", () => {
  it("rejects the approval namespace before any paid reservation", async () => {
    await expect(reserveUsage(scope, "approve:action-1", "TEXT", now)).rejects.toThrow("ASSISTANT_REQUEST_ID_RESERVED");
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
  });
  it("does not authorize another paid attempt after an abandoned reservation", async () => {
    const first = await reserveUsage(scope, "crashed-request", "TEXT", now);
    expect(first).toEqual({ id: "usage_1", fresh: true });
    // Simulate process death after the provider call but before finalization.
    mockedDb.assistantUsage.findUnique.mockResolvedValue({ id: "usage_1" });
    const retry = await reserveUsage(scope, "crashed-request", "TEXT", new Date(now.getTime() + 31_000));
    expect(retry).toEqual({ id: "usage_1", fresh: false });
    expect(mockedDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedDb.assistantUsage.update).not.toHaveBeenCalled();
  });
  it("creates the unique reservation then conditionally increments the Lagos day", async () => {
    const tx = transactionClient();
    mockedDb.$transaction.mockImplementation(async (callback: (tx: ReturnType<typeof transactionClient>) => Promise<unknown>) =>
      callback(tx),
    );

    await expect(reserveUsage(scope, "r1", "TEXT", now)).resolves.toEqual({
      id: "usage_1", fresh: true,
    });

    expect(tx.assistantUsage.create).toHaveBeenCalledWith({
      data: objectContaining({
        conversationId: "conv_1",
        businessId: "biz_1",
        requestId: "r1",
        channel: "WHATSAPP",
        mode: "TEXT",
        model: "gpt-5.4-mini",
        outcome: "running",
      }),
      select: { id: true },
    });
    const [call] = tx.$queryRaw.mock.calls;
    const [strings, ...values] = call!;
    expect(strings.join(" ")).toContain("AssistantDailyUsage");
    expect(strings.join(" ")).toContain("ON CONFLICT");
    expect(values).toEqual(["biz_1", "2026-11-04", 100]);
  });

  it("returns null without a database call when the assistant is off", async () => {
    mockedEnv.ASSISTANT_ENABLED = false;

    await expect(reserveUsage(scope, "r1", "TEXT", now)).resolves.toBeNull();
    expect(mockedGetConversation).not.toHaveBeenCalled();
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
  });

  it("returns null without a key", async () => {
    mockedEnv.OPENAI_API_KEY = undefined;

    await expect(reserveUsage(scope, "r1", "TEXT", now)).resolves.toBeNull();
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
  });

  it("returns the existing reservation for a duplicate request", async () => {
    mockedDb.assistantUsage.findUnique.mockResolvedValue({ id: "usage_0" });

    await expect(reserveUsage(scope, "r1", "TEXT", now)).resolves.toEqual({
      id: "usage_0", fresh: false,
    });
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
  });

  it("rolls back and returns null when the conditional increment loses", async () => {
    const tx = transactionClient({ dailyRows: [] });
    mockedDb.$transaction.mockImplementation(async (callback: (tx: ReturnType<typeof transactionClient>) => Promise<unknown>) =>
      callback(tx),
    );

    await expect(reserveUsage(scope, "r1", "TEXT", now)).resolves.toBeNull();
    expect(tx.assistantUsage.create).toHaveBeenCalled();
  });

  it("allows only the final slot when two reservations race the daily cap", async () => {
    mockedEnv.ASSISTANT_DAILY_LIMIT = 1;
    let count = 0;
    mockedDb.$transaction.mockImplementation(async (callback: (tx: ReturnType<typeof transactionClient>) => Promise<unknown>) => {
      const tx = transactionClient();
      tx.$queryRaw.mockImplementation(async () => count < 1 ? [{ count: ++count }] : []);
      return callback(tx);
    });
    const results = await Promise.all([
      reserveUsage(scope, "r1", "TEXT", now), reserveUsage(scope, "r2", "TEXT", now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((value) => value === null)).toHaveLength(1);
    expect(count).toBe(1);
  });

  it("retrieves the winner after a duplicate insert race", async () => {
    mockedDb.assistantUsage.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "usage_winner" });
    mockedDb.$transaction.mockRejectedValue(
      Object.assign(new Error("duplicate"), { code: "P2002" }),
    );

    await expect(reserveUsage(scope, "r1", "TEXT", now)).resolves.toEqual({
      id: "usage_winner", fresh: false,
    });
  });

  it("rethrows a database outage", async () => {
    mockedDb.$transaction.mockRejectedValue(new Error("connection lost"));

    await expect(reserveUsage(scope, "r1", "TEXT", now)).rejects.toThrow(
      "connection lost",
    );
  });
});

describe("finishUsage", () => {
  it("allows only the original execution to finalize after an orphan replay without losing its counters", async () => {
    mockedDb.assistantUsage.findUnique.mockResolvedValue({ id: "usage_1", model: "gpt-5.4-mini", mode: "TEXT", audioSeconds: null, inputTokens: 500, cachedTokens: 100, outputTokens: 20, durationMs: 1000 });
    const recovered = await reserveUsage(scope, "orphan", "TEXT", now);
    expect(recovered).toEqual({ id: "usage_1", fresh: false });
    // Recovery does not finalize anything; the original paid owner arrives late.
    expect(mockedDb.assistantUsage.update).not.toHaveBeenCalled();
    await finishUsage("usage_1", { outcome: "answered", durationMs: 1200, providerRequestIds: ["original-provider-request"] });
    expect(mockedDb.assistantUsage.update).toHaveBeenCalledTimes(1);
    expect(mockedDb.assistantUsage.update).toHaveBeenCalledWith({ where: { id: "usage_1" }, data: objectContaining({ inputTokens: 500, cachedTokens: 100, outputTokens: 20, providerRequestIds: ["original-provider-request"] }) });
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
  });
  it("keeps prior tokens when a later accounting patch omits counters", async () => {
    mockedDb.assistantUsage.findUnique.mockResolvedValue({ model: "gpt-5.4-mini", mode: "TEXT", audioSeconds: null, inputTokens: 1000, cachedTokens: 400, outputTokens: 100, durationMs: 1200 });
    await finishUsage("usage_1", { outcome: "answered" });
    expect(mockedDb.assistantUsage.update).toHaveBeenCalledWith({ where: { id: "usage_1" }, data: objectContaining({ inputTokens: 1000, cachedTokens: 400, outputTokens: 100, estimatedCostUsd: "0.00093000" }) });
  });
  it("cannot turn an uncertain aborted request into a zero-cost success", async () => {
    mockedDb.assistantUsage.findUnique.mockResolvedValue({ model: "gpt-5.4-mini", mode: "TEXT", audioSeconds: null, inputTokens: 100, cachedTokens: 0, outputTokens: 20, durationMs: 1200 });
    await finishUsage("usage_1", { outcome: "answered", billingUnknown: true, estimatedCostUsd: "0.00000000" });
    expect(mockedDb.assistantUsage.update).toHaveBeenCalledWith({ where: { id: "usage_1" }, data: objectContaining({ estimatedCostUsd: null, pricingVersion: null }) });
  });
  it("patches summed tokens, elapsed time and the computed cost", async () => {
    mockedDb.assistantUsage.findUnique.mockResolvedValue({
      model: "gpt-5.4-mini",
      mode: "TEXT",
      audioSeconds: null,
      inputTokens: 0, cachedTokens: 0, outputTokens: 0, durationMs: 0,
    });

    await finishUsage("usage_1", {
      inputTokens: 1000,
      cachedTokens: 400,
      outputTokens: 100,
      providerRequestIds: ["req_1"],
      durationMs: 1200,
      outcome: "answered",
    });

    expect(mockedDb.assistantUsage.update).toHaveBeenCalledWith({
      where: { id: "usage_1" },
      data: {
        inputTokens: 1000,
        cachedTokens: 400,
        outputTokens: 100,
        providerRequestIds: ["req_1"],
        durationMs: 1200,
        outcome: "answered",
        estimatedCostUsd: "0.00093000",
        pricingVersion: PRICING_VERSION,
      },
    });
  });

  it("records failed transcription usage before the turn errors", async () => {
    mockedDb.assistantUsage.findUnique.mockResolvedValue({
      model: "gpt-5.4-mini",
      mode: "VOICE",
      audioSeconds: null,
      inputTokens: 0, cachedTokens: 0, outputTokens: 0, durationMs: 0,
    });

    await finishUsage("usage_1", {
      audioSeconds: 30,
      durationMs: 800,
      outcome: "error",
    });

    expect(mockedDb.assistantUsage.update).toHaveBeenCalledWith({
      where: { id: "usage_1" },
      data: objectContaining({
        audioSeconds: 30,
        outcome: "error",
        estimatedCostUsd: null,
        pricingVersion: null,
      }),
    });
  });

  it("keeps an unknown model cost null instead of zero", async () => {
    mockedDb.assistantUsage.findUnique.mockResolvedValue({
      model: "gpt-future",
      mode: "TEXT",
      audioSeconds: null,
      inputTokens: 0, cachedTokens: 0, outputTokens: 0, durationMs: 0,
    });

    await finishUsage("usage_1", {
      inputTokens: 100,
      outcome: "answered",
    });

    expect(mockedDb.assistantUsage.update).toHaveBeenCalledWith({
      where: { id: "usage_1" },
      data: objectContaining({
        estimatedCostUsd: null,
        pricingVersion: null,
      }),
    });
  });
});

describe("recordApprovalUsage", () => {
  it("upserts an approval row without incrementing the daily AI count", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await recordApprovalUsage(
      scope,
      "action_1",
      new Date(now.getTime() - 1500),
      "approved",
    );

    expect(mockedDb.assistantUsage.upsert).toHaveBeenCalledWith({
      where: {
        conversationId_requestId: {
          conversationId: "conv_1",
          requestId: "approve:action_1",
        },
      },
      create: objectContaining({
        conversationId: "conv_1",
        businessId: "biz_1",
        requestId: "approve:action_1",
        channel: "WHATSAPP",
        mode: "APPROVAL",
        model: "none",
        estimatedCostUsd: "0.00000000",
        pricingVersion: PRICING_VERSION,
        durationMs: 1500,
        outcome: "approved",
      }),
      update: objectContaining({
        estimatedCostUsd: "0.00000000",
        durationMs: 1500,
        outcome: "approved",
      }),
    });
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
  });
});

describe("UsageAccumulator", () => {
  it("keeps completed-round counters while marking aborted billing unknown", () => {
    const usage = new UsageAccumulator();
    usage.addResponseUsage({ input_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 120 });
    usage.markBillingUnknown();
    expect(usage.patch("error", 25_000)).toMatchObject({ inputTokens: 100, outputTokens: 20, billingUnknown: true });
  });
  it("marks a successful response without usage as unknown", () => {
    const usage = new UsageAccumulator();
    usage.addResponseUsage(null, "request-1");
    expect(usage.patch("answered", 100)).toMatchObject({ billingUnknown: true, providerRequestIds: ["request-1"] });
  });

  it("starts at zero and sums every completed response round", () => {
    const usage = new UsageAccumulator();
    expect(usage.inputTokens).toBe(0);
    expect(usage.cachedTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
    expect(usage.audioSeconds).toBe(0);

    const first: ResponseUsage = {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 40, cache_write_tokens: 0 },
      output_tokens: 20,
      output_tokens_details: { reasoning_tokens: 5 },
      total_tokens: 120,
    };
    usage.addResponseUsage(first, "req_1");
    usage.addResponseUsage(
      {
        ...first,
        input_tokens: 50,
        input_tokens_details: { cached_tokens: 10, cache_write_tokens: 0 },
        output_tokens: 5,
      },
      "req_2",
    );
    usage.addAudioSeconds(12.5);

    expect(usage.inputTokens).toBe(150);
    expect(usage.cachedTokens).toBe(50);
    expect(usage.outputTokens).toBe(25);
    expect(usage.audioSeconds).toBe(12.5);
    expect(usage.providerRequestIds).toEqual(["req_1", "req_2"]);
    expect(usage.patch("answered", 900)).toEqual({
      inputTokens: 150,
      cachedTokens: 50,
      outputTokens: 25,
      audioSeconds: 12.5,
      providerRequestIds: ["req_1", "req_2"],
      durationMs: 900,
      outcome: "answered",
    });
  });
});

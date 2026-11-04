import type { ResponseUsage } from "openai/resources/responses/responses";

import { db } from "@/server/db";

import { assistantConfig } from "./config";
import { lagosDay } from "./clock";
import { getConversation } from "./store";
import type { AssistantScope } from "./types";

/**
 * Version of the rate card used to calculate `estimatedCostUsd`. Rates were
 * checked on 2026-11-04 against https://developers.openai.com/api/docs/pricing
 * and the official model pages; bump this whenever they change.
 */
export const PRICING_VERSION = "openai-2026-11-04";

const USD_PER_MILLION = 1_000_000;
const WHISPER_MODEL = "whisper-1";
const WHISPER_USD_PER_MINUTE = 0.006;
const ZERO_COST = "0.00000000";

type TokenRates = {
  input: number;
  cached: number;
  output: number;
};

/** USD per million tokens for the models the assistant is configured to use. */
const MODEL_RATES: Record<string, TokenRates> = {
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
};

export type UsageMode = "VOICE" | "TEXT" | "APPROVAL";

/** Only a fresh reservation authorizes one paid execution of this request. */
export type UsageReservation = { id: string; fresh: boolean };

export type UsageOutcome =
  | "answered"
  | "draft"
  | "approved"
  | "error"
  | "denied";

export type UsagePatch = {
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  providerRequestIds?: string[];
  durationMs?: number;
  outcome: UsageOutcome;
  model?: string;
  estimatedCostUsd?: string | null;
  pricingVersion?: string | null;
  /** True if a paid request may have completed without returning usage. */
  billingUnknown?: boolean;
  transcribeModel?: string;
};

export type CostEstimateInput = {
  model: string;
  input: number;
  cached: number;
  output: number;
  audioSeconds: number;
  transcribeModel?: string;
};

export type CostEstimate = {
  usd: string | null;
  pricingVersion: string | null;
};

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clampCount(value: number): number {
  return Math.floor(nonNegative(value));
}

/** Billed USD as an 8-decimal string, or null for an unknown model. */
export function estimateCost(input: CostEstimateInput): CostEstimate {
  const audioSeconds = nonNegative(input.audioSeconds);
  if (audioSeconds > 0 && (input.transcribeModel ?? WHISPER_MODEL) !== WHISPER_MODEL) {
    return { usd: null, pricingVersion: null };
  }

  if (input.model === WHISPER_MODEL) {
    return {
      usd: ((audioSeconds * WHISPER_USD_PER_MINUTE) / 60).toFixed(8),
      pricingVersion: PRICING_VERSION,
    };
  }

  const rates = MODEL_RATES[input.model];
  if (!rates) return { usd: null, pricingVersion: null };

  const inputTokens = clampCount(input.input);
  const cachedTokens = Math.min(clampCount(input.cached), inputTokens);
  const uncachedTokens = inputTokens - cachedTokens;
  const outputTokens = clampCount(input.output);

  const tokenCost =
    (uncachedTokens * rates.input +
      cachedTokens * rates.cached +
      outputTokens * rates.output) /
    USD_PER_MILLION;
  const audioCost = (audioSeconds * WHISPER_USD_PER_MINUTE) / 60;

  return {
    usd: (tokenCost + audioCost).toFixed(8),
    pricingVersion: PRICING_VERSION,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return error.code === "P2002";
}

/**
 * Reserve one paid assistant turn.
 *
 * Returns null when the assistant is off, unavailable or over its daily cap.
 * Only fresh:true permits paid work. An existing or raced reservation returns
 * fresh:false and must terminate/replay the turn without any provider call or
 * accounting patch. Retrying paid work requires a distinct request id and slot.
 */
export async function reserveUsage(
  scope: AssistantScope,
  requestId: string,
  mode: Exclude<UsageMode, "APPROVAL">,
  now: Date,
): Promise<UsageReservation | null> {
  if (requestId.startsWith("approve:")) {
    throw new Error("ASSISTANT_REQUEST_ID_RESERVED");
  }
  const config = assistantConfig();
  if (!config.enabled || !config.available) return null;

  const conversation = await getConversation(scope);
  const existing = await db.assistantUsage.findUnique({
    where: {
      conversationId_requestId: {
        conversationId: conversation.id,
        requestId,
      },
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, fresh: false };

  try {
    return await db.$transaction(async (tx) => {
      const reservation = await tx.assistantUsage.create({
        data: {
          conversationId: conversation.id,
          businessId: scope.businessId,
          requestId,
          channel: scope.channel,
          mode,
          audioSeconds: null,
          model: config.model,
          inputTokens: 0,
          cachedTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: null,
          pricingVersion: null,
          durationMs: 0,
          outcome: "running",
          providerRequestIds: [],
        },
        select: { id: true },
      });

      // Conditional increment: a reservation that would exceed the cap gets
      // no row back. Throwing rolls the usage row back with it.
      const rows = await tx.$queryRaw<{ count: number }[]>`
        INSERT INTO "AssistantDailyUsage" ("businessId", "day", "count")
        VALUES (${scope.businessId}, ${lagosDay(now)}, 1)
        ON CONFLICT ("businessId", "day") DO UPDATE
        SET "count" = "AssistantDailyUsage"."count" + 1
        WHERE "AssistantDailyUsage"."count" < ${config.dailyLimit}
        RETURNING "count"
      `;
      if (rows.length === 0) throw new Error("ASSISTANT_LIMIT_REACHED");
      return { id: reservation.id, fresh: true };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ASSISTANT_LIMIT_REACHED") {
      return null;
    }
    if (isUniqueViolation(error)) {
      const raced = await db.assistantUsage.findUnique({
        where: {
          conversationId_requestId: {
            conversationId: conversation.id,
            requestId,
          },
        },
        select: { id: true },
      });
      if (raced) return { id: raced.id, fresh: false };
    }
    throw error;
  }
}

function mergeAudioSeconds(
  existing: number | null,
  patch: UsagePatch,
): number | null {
  if (patch.audioSeconds === undefined) return existing;
  return nonNegative(patch.audioSeconds);
}

/** Store the summed usage after a turn succeeds, fails or is aborted. */
export async function finishUsage(
  id: string,
  patch: UsagePatch,
): Promise<void> {
  const existing = await db.assistantUsage.findUnique({
    where: { id },
    select: { model: true, mode: true, audioSeconds: true, inputTokens: true, cachedTokens: true, outputTokens: true, durationMs: true },
  });
  if (!existing) throw new Error("ASSISTANT_USAGE_NOT_FOUND");

  const audioSeconds = mergeAudioSeconds(existing.audioSeconds, patch);
  let cost: CostEstimate;
  if (existing.mode !== "APPROVAL" && (patch.billingUnknown || patch.outcome === "error")) {
    // Errors/timeouts cannot prove the provider did no billable work. Known
    // counters are still retained, but never present a partial total as final.
    cost = { usd: null, pricingVersion: null };
  } else if ("estimatedCostUsd" in patch) {
    cost = {
      usd: patch.estimatedCostUsd ?? null,
      pricingVersion: patch.pricingVersion ?? null,
    };
  } else if (existing.mode === "APPROVAL") {
    cost = { usd: ZERO_COST, pricingVersion: PRICING_VERSION };
  } else {
    cost = estimateCost({
      model: patch.model ?? existing.model,
      input: patch.inputTokens ?? existing.inputTokens,
      cached: patch.cachedTokens ?? existing.cachedTokens,
      output: patch.outputTokens ?? existing.outputTokens,
      audioSeconds: audioSeconds ?? 0,
      transcribeModel: patch.transcribeModel ?? assistantConfig().transcribeModel,
    });
  }

  await db.assistantUsage.update({
    where: { id },
    data: {
      ...(patch.model === undefined ? {} : { model: patch.model }),
      inputTokens: clampCount(patch.inputTokens ?? existing.inputTokens),
      cachedTokens: clampCount(patch.cachedTokens ?? existing.cachedTokens),
      outputTokens: clampCount(patch.outputTokens ?? existing.outputTokens),
      ...(audioSeconds === null ? {} : { audioSeconds }),
      ...(patch.providerRequestIds === undefined
        ? {}
        : { providerRequestIds: patch.providerRequestIds }),
      durationMs: clampCount(patch.durationMs ?? existing.durationMs),
      outcome: patch.outcome,
      estimatedCostUsd: cost.usd,
      pricingVersion: cost.pricingVersion,
    },
  });
}

/**
 * Approval paths make no OpenAI call, so they never touch the daily AI-turn
 * counter. The action id is the idempotency key.
 */
export async function recordApprovalUsage(
  scope: AssistantScope,
  actionId: string,
  startedAt: Date,
  outcome: UsageOutcome,
): Promise<void> {
  const conversation = await getConversation(scope);
  const requestId = `approve:${actionId}`;
  const durationMs = clampCount(Date.now() - startedAt.getTime());

  await db.assistantUsage.upsert({
    where: {
      conversationId_requestId: {
        conversationId: conversation.id,
        requestId,
      },
    },
    create: {
      conversationId: conversation.id,
      businessId: scope.businessId,
      requestId,
      channel: scope.channel,
      mode: "APPROVAL",
      audioSeconds: null,
      model: "none",
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: ZERO_COST,
      pricingVersion: PRICING_VERSION,
      durationMs,
      outcome,
      providerRequestIds: [],
    },
    update: {
      durationMs,
      outcome,
      estimatedCostUsd: ZERO_COST,
      pricingVersion: PRICING_VERSION,
    },
  });
}

/**
 * Accumulates every completed Responses round of one turn. A failed later
 * round must not erase earlier tokens, so callers add each response as it
 * arrives and finalize once in `finally`.
 */
export class UsageAccumulator {
  inputTokens = 0;
  cachedTokens = 0;
  outputTokens = 0;
  audioSeconds = 0;
  providerRequestIds: string[] = [];
  private billingUnknown = false;

  markBillingUnknown(): void {
    this.billingUnknown = true;
  }

  addResponseUsage(
    usage: ResponseUsage | null | undefined,
    providerRequestId?: string | null,
  ): void {
    if (!usage) this.markBillingUnknown();
    if (usage) {
      this.inputTokens += clampCount(usage.input_tokens ?? 0);
      this.cachedTokens += clampCount(
        usage.input_tokens_details?.cached_tokens ?? 0,
      );
      this.outputTokens += clampCount(usage.output_tokens ?? 0);
    }
    this.addProviderRequestId(providerRequestId);
  }

  addAudioSeconds(seconds: number): void {
    this.audioSeconds += nonNegative(seconds);
  }

  addProviderRequestId(providerRequestId?: string | null): void {
    if (providerRequestId && !this.providerRequestIds.includes(providerRequestId)) {
      this.providerRequestIds.push(providerRequestId);
    }
  }

  patch(outcome: UsageOutcome, durationMs: number): UsagePatch {
    return {
      inputTokens: this.inputTokens,
      cachedTokens: this.cachedTokens,
      outputTokens: this.outputTokens,
      audioSeconds: this.audioSeconds,
      providerRequestIds: this.providerRequestIds,
      durationMs,
      outcome,
      ...(this.billingUnknown ? { billingUnknown: true } : {}),
    };
  }
}

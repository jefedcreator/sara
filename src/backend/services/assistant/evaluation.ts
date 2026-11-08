import type { Prisma } from "@prisma/client";
import type { ResponseOutputItem, ResponseUsage } from "openai/resources/responses/responses";
import type { DraftDto } from "@/types/assistant";
import { EVALUATION_CASES, type EvaluationCase } from "../../../../evals/assistant/cases";
import { CANNED_CALLS } from "../../../../evals/assistant/canned";
import { createFixtureDispatcher } from "../../../../evals/assistant/dispatcher";
import { IDS, NOW, SCOPE } from "../../../../evals/assistant/fixtures";
import { runModelTurn, type ModelDependencies, type ResponsesTransport } from "./loop";
import type { ToolOutcome } from "./tools/registry";
import type { StoredTurn } from "./types";
import { assistantConfig } from "./config";
import { estimateCost, UsageAccumulator } from "./usage";

export type EvaluationResult = {
  id: string;
  kind: "read" | "draft" | "clarification" | "unsupported" | "error";
  tool: string | null;
  normalizedFacts: Record<string, string | number | boolean>;
  domainWrites: number;
  toolNames: string[];
  timingMs: number;
  usage: { inputTokens: number; cachedTokens: number; outputTokens: number };
  estimatedCostUsd: string | null;
};
export type EvaluationDependencies = Partial<ModelDependencies>;

/** Responses protocol replay. Each recording belongs to one owner turn. */
function replayTransport(testCase: EvaluationCase, turn: number): ResponsesTransport {
  let sent = false;
  return async () => {
    const calls = sent ? [] : CANNED_CALLS[testCase.id]?.[turn];
    if (!calls) throw new Error("Missing protocol recording");
    sent = true;
    const output: ResponseOutputItem[] = calls.map((call, index) => ({
      id: `fc_${turn}_${index}`, type: "function_call", call_id: `call_${turn}_${index}`,
      name: call.name, arguments: JSON.stringify(call.args), status: "completed",
    }));
    const usage: ResponseUsage = { input_tokens: 10, output_tokens: 20, total_tokens: 30,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
    return { output, usage };
  };
}

/** No global database replacement: every evaluation owns a read-only fixture adapter. */
export async function runEvaluationCase(testCase: EvaluationCase, dependencies: EvaluationDependencies = {}): Promise<EvaluationResult> {
  const started = Date.now();
  const fixture = createFixtureDispatcher();
  const usage = new UsageAccumulator();
  const history: StoredTurn[] = [];
  const toolNames: string[] = [];
  let last: { name: string; outcome: ToolOutcome } | undefined;
  let pending: DraftDto | null = null;
  let finalReply = "";
  let executionFailed = false;
  for (let turn = 0; turn < testCase.turns.length; turn += 1) {
    const text = testCase.turns[turn]!;
    last = undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const result = await runModelTurn({
        context: { scope: SCOPE, conversationId: IDS.conversation, memoryVersion: 0,
          leaseToken: "fixture-only", now: NOW, signal: controller.signal,
          evidence: { text, recentOwnerTexts: history.map((item) => item.userText), selectedIds: [] } },
        text, history, business: { name: "Evaluation shop", currency: "NGN", sells: "BOTH" }, usage,
        ...(dependencies.responses ? {} : { transport: replayTransport(testCase, turn) }),
        dispatch: async (context, name, args) => {
          toolNames.push(name);
          const outcome = await (dependencies.dispatch ?? fixture.dispatch)(context, name, args);
          last = { name, outcome };
          return outcome;
        },
      }, dependencies.responses ? { responses: dependencies.responses, dispatch: async (context, name, args) => {
        toolNames.push(name);
        const outcome = await (dependencies.dispatch ?? fixture.dispatch)(context, name, args);
        last = { name, outcome };
        return outcome;
      } } : undefined);
      finalReply = result.reply;
      pending = result.draft;
      history.push({ userText: text, transcript: null, reply: result.reply, toolRecords: result.toolRecords, createdAt: NOW });
    } catch {
      // Keep completed-round counters when a later round fails. Exceptions
      // can include provider/private content, so only the error kind escapes.
      usage.markBillingUnknown();
      executionFailed = true;
      break;
    } finally { clearTimeout(timer); }
  }
  const observed = last;
  const kind = executionFailed ? "error" : pending ? "draft" : observed?.outcome.kind === "read" ? "read"
    : observed?.outcome.kind === "clarification" || observed?.outcome.kind === "error" ? "clarification" : "unsupported";
  const normalizedFacts = { ...fixture.facts };
  if (kind === "unsupported") {
    normalizedFacts.mentionsMenu = /menu/i.test(finalReply);
    normalizedFacts.pendingWrites = 0;
  }
  // External fixture dispatchers may return normalized read facts directly.
  if (dependencies.dispatch && observed?.outcome.kind === "read") {
    for (const [key, value] of Object.entries((observed.outcome.data ?? {}) as Prisma.JsonObject)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") normalizedFacts[key] = value;
    }
  }
  const cost = estimateCost({ model: assistantConfig().model, input: usage.inputTokens,
    cached: usage.cachedTokens, output: usage.outputTokens, audioSeconds: 0 });
  return { id: testCase.id, kind, tool: observed?.name ?? null, normalizedFacts,
    domainWrites: fixture.domainWrites, toolNames, timingMs: Date.now() - started,
    usage: { inputTokens: usage.inputTokens, cachedTokens: usage.cachedTokens, outputTokens: usage.outputTokens },
    estimatedCostUsd: dependencies.responses
      ? usage.patch("answered", Date.now() - started).billingUnknown ? null : cost.usd
      : "0.00000000" };
}

export async function evaluateCases(cases: EvaluationCase[] = EVALUATION_CASES, dependencies: EvaluationDependencies = {}) {
  const failed: { id: string; reason: string }[] = [];
  const timingsMs: number[] = [];
  const results: EvaluationResult[] = [];
  for (const testCase of cases) {
    try {
      const result = await runEvaluationCase(testCase, dependencies);
      results.push(result); timingsMs.push(result.timingMs);
      if (result.kind !== testCase.expected.kind || result.tool !== testCase.expected.tool) {
        failed.push({ id: testCase.id, reason: `Expected ${testCase.expected.kind}/${testCase.expected.tool}, got ${result.kind}/${result.tool}` });
        continue;
      }
      const mismatch = Object.entries(testCase.expected.facts).find(([key, value]) => result.normalizedFacts[key] !== value);
      if (mismatch) failed.push({ id: testCase.id, reason: `Fact mismatch: ${mismatch[0]}` });
      else if (testCase.expected.forbiddenWrites && result.domainWrites !== 0) failed.push({ id: testCase.id, reason: "Forbidden domain write" });
    } catch {
      // Provider/database exceptions may contain customer text or credentials.
      failed.push({ id: testCase.id, reason: "Evaluation execution failed" });
    }
  }
  const estimatedCostUsd = (dependencies.responses && failed.length > 0) || results.some((result) => result.estimatedCostUsd === null) ? null
    : results.reduce((sum, result) => sum + Number(result.estimatedCostUsd), 0).toFixed(8);
  return { passed: cases.length - failed.length, failed, estimatedCostUsd, timingsMs,
    usage: { inputTokens: results.reduce((n, r) => n + r.usage.inputTokens, 0),
      cachedTokens: results.reduce((n, r) => n + r.usage.cachedTokens, 0),
      outputTokens: results.reduce((n, r) => n + r.usage.outputTokens, 0) } };
}

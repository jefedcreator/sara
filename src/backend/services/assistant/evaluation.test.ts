import { describe, expect, it, vi } from "vitest";
import { EVALUATION_CASES } from "../../../../evals/assistant/cases";
import { createFixtures, fixtureDatabase, IDS } from "../../../../evals/assistant/fixtures";
import { createFixtureDispatcher } from "../../../../evals/assistant/dispatcher";
import { evaluateCases, runEvaluationCase } from "./evaluation";

vi.mock("@/env", () => ({ env: { ASSISTANT_ENABLED: true, ASSISTANT_DAILY_LIMIT: 100,
  OPENAI_ASSISTANT_MODEL: "gpt-5.4-mini", OPENAI_TRANSCRIBE_MODEL: "whisper-1" } }));

describe("assistant fixture evaluation gate", () => {
  it("checks all 30 protocol recordings against independent structured expectations", async () => {
    const result = await evaluateCases();
    expect(result.failed).toEqual([]);
    expect(result.passed).toBe(30);
    expect(result.estimatedCostUsd).toBe("0.00000000");
  });

  it("runs every correction turn and retains its replacement facts", async () => {
    const result = await runEvaluationCase(EVALUATION_CASES.find((item) => item.id === "15")!);
    expect(result.normalizedFacts).toMatchObject({ quantity: 3, totalMinor: 1500000, draftCount: 2, priorReplaced: true });
    expect(result.toolNames).toHaveLength(2);
    expect(result.domainWrites).toBe(0);
  });

  it("fails on an ungrounded numeric result instead of grading prose", async () => {
    const testCase = structuredClone(EVALUATION_CASES.find((item) => item.id === "04")!);
    testCase.expected.facts.totalMinor = 1;
    const result = await evaluateCases([testCase]);
    expect(result.failed).toEqual([{ id: "04", reason: "Fact mismatch: totalMinor" }]);
  });

  it("honors an injected Responses transport with the real fixture dispatcher", async () => {
    const responses = { create: vi.fn().mockResolvedValueOnce({ output: [{ type: "function_call", id: "fc1", call_id: "c1",
      name: "get_customer", arguments: JSON.stringify({ name: "get_customer", customerId: IDS.tolu }) }],
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20 } })
      .mockResolvedValueOnce({ output: [], usage: { input_tokens: 50, output_tokens: 10 } }) };
    const result = await runEvaluationCase(EVALUATION_CASES.find((item) => item.id === "08")!, { responses: responses });
    expect(responses.create).toHaveBeenCalledTimes(2);
    expect(result.normalizedFacts.outstandingMinor).toBe(6000000);
    expect(result.usage).toEqual({ inputTokens: 150, cachedTokens: 0, outputTokens: 30 });
    expect(Number(result.estimatedCostUsd)).toBeGreaterThan(0);
  });

  it("never supports fixture database writes or unknown read operators", async () => {
    const forbidden = vi.fn((): never => { throw new Error("FORBIDDEN_WRITE"); });
    const database = fixtureDatabase(createFixtures(), forbidden);
    expect(() => database.customer.create({ data: {} as never })).toThrow("FORBIDDEN_WRITE");
    expect(forbidden).toHaveBeenCalledOnce();
    await expect(database.customer.findMany({ where: { name: { startsWith: "A" } } })).rejects.toThrow("Unsupported fixture predicate");
  });

  it("retains known usage and marks cost unknown when a later live round fails", async () => {
    const responses = { create: vi.fn().mockResolvedValueOnce({ output: [{ type: "function_call", id: "fc1", call_id: "c1",
      name: "get_customer", arguments: JSON.stringify({ name: "get_customer", customerId: IDS.tolu }) }],
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 10 }, output_tokens: 20 } })
      .mockRejectedValueOnce(new Error("private provider response")) };
    const result = await evaluateCases([EVALUATION_CASES.find((item) => item.id === "08")!], { responses });
    expect(result.passed).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.usage).toEqual({ inputTokens: 100, cachedTokens: 10, outputTokens: 20 });
    expect(result.estimatedCostUsd).toBeNull();
    expect(JSON.stringify(result)).not.toContain("private provider response");
  });

  it("rejects mutation tools before any real data can be accessed", async () => {
    const fixture = createFixtureDispatcher();
    await expect(fixture.dispatch({ scope: { businessId: IDS.business, principalId: IDS.owner, channel: "WEB" },
      conversationId: IDS.conversation, memoryVersion: 0, now: new Date(), signal: new AbortController().signal,
      evidence: { text: "", recentOwnerTexts: [], selectedIds: [] } }, "execute_sql", '{}')).rejects.toThrow();
    expect(fixture.domainWrites).toBe(0);
  });
});

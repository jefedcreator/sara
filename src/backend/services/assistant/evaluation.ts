import type { ModelDependencies } from "@/backend/services/assistant/loop";
import { runModelTurn } from "@/backend/services/assistant/loop";
import type { AssistantScope } from "@/backend/services/assistant/types";
import type { EvaluationCase } from "../../../../evals/assistant/cases";
import { EVALUATION_CASES, type ScriptedCall } from "../../../../evals/assistant/cases";
import { CANNED_CALLS } from "../../../../evals/assistant/canned";
import { createFixtures, fixtureDatabase, NOW, SCOPE, IDS } from "../../../../evals/assistant/fixtures";
import { db } from "@/server/db";
import { assistantConfig } from "./config";

/**
 * Run a single evaluation case and return the observed result.
 * The fake dispatcher returns read fixtures and draft previews, records normalized
 * proposed payloads, and has no approval/domain-mutation implementation.
 */
export async function runEvaluationCase(
  testCase: EvaluationCase,
  dependencies?: ModelDependencies,
): Promise<{
  id: string;
  kind: "read" | "draft" | "clarification" | "unsupported" | "error";
  tool: string | null;
  normalizedFacts: Record<string, string | number | boolean>;
  domainWrites: number;
  toolNames: string[];
  timingMs: number;
  error?: string;
}> {
  const startTime = Date.now();
  const fixtures = createFixtures();
  let domainWrites = 0;

  // Create a fake dispatcher that records tool calls
  const recordedTools: ScriptedCall[] = [];
  const dispatchTool = async (name: string, args: unknown) => {
    recordedTools.push({ name, args: args as any });
    // Return canned responses if available
    const cannedForCase = CANNED_CALLS[testCase.id];
    if (cannedForCase) {
      // Find matching call
      for (const callGroup of cannedForCase) {
        for (const call of callGroup) {
          if (call.name === name) {
            return call.args as any;
          }
        }
      }
    }
    // Return empty result for unmatched calls
    return { kind: "read", data: null, text: "" } as any;
  };

  // Create fake database that forbids writes
  const fakeDb = fixtureDatabase(fixtures, () => {
    domainWrites++;
    throw new Error("FORBIDDEN_WRITE");
  });

  // Create scope
  const scope: AssistantScope = SCOPE;

  // Mock the db for this test
  const originalDb = global.db;
  try {
    // @ts-expect-error - assigning to global
    global.db = fakeDb;

    // Create a fake transport that returns canned responses
    const transport = {
      create: async (input: any) => {
        const cannedForCase = CANNED_CALLS[testCase.id];
        if (cannedForCase && cannedForCase.length > 0) {
          // Return the first group of calls
          const firstGroup = cannedForCase[0];
          return {
            output: firstGroup.map((call: ScriptedCall) => ({
              id: call.name,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
            usage: { input_tokens: 10, output_tokens: 20 },
          } as any;
        }
        return {
          output: [],
          usage: { input_tokens: 0, output_tokens: 0 },
        } as any;
      },
    };

    const dependenciesWithFakes: ModelDependencies = {
      ...dependencies,
      responses: transport as any,
      dispatch: dispatchTool as any,
    };

    // Run the model turn for each turn in the case
    for (const turn of testCase.turns) {
      const result = await runModelTurn(
        {
          scope,
          requestId: `req-${Math.random().toString(36).slice(2)}`,
          text: turn,
          context: {
            conversationId: IDS.conversation,
            leaseToken: "test-token",
            memoryVersion: 1,
            checkCurrent: async () => {},
            signal: new AbortController().signal,
          },
        },
        dependenciesWithFakes,
      );

      // Check the result
      if (result.draft) {
        return {
          id: testCase.id,
          kind: "draft",
          tool: result.draft.kind,
          normalizedFacts: extractFacts(result.draft),
          domainWrites,
          toolNames: recordedTools.map((t) => t.name),
          timingMs: Date.now() - startTime,
        };
      }

      if (result.reply.includes("What should I") || result.reply.includes("?")) {
        return {
          id: testCase.id,
          kind: "clarification",
          tool: recordedTools.length > 0 ? recordedTools[0].name : null,
          normalizedFacts: {},
          domainWrites,
          toolNames: recordedTools.map((t) => t.name),
          timingMs: Date.now() - startTime,
        };
      }
    }

    // If we get here, check if it's a read result
    if (recordedTools.length > 0 && recordedTools[0].name.startsWith("read_")) {
      return {
        id: testCase.id,
        kind: "read",
        tool: recordedTools[0].name,
        normalizedFacts: extractFactsFromTools(recordedTools),
        domainWrites,
        toolNames: recordedTools.map((t) => t.name),
        timingMs: Date.now() - startTime,
      };
    }

    // Check for unsupported
    if (recordedTools.length === 0) {
      return {
        id: testCase.id,
        kind: "unsupported",
        tool: null,
        normalizedFacts: {},
        domainWrites,
        toolNames: [],
        timingMs: Date.now() - startTime,
      };
    }

    return {
      id: testCase.id,
      kind: "error",
      tool: null,
      normalizedFacts: {},
      domainWrites,
      toolNames: recordedTools.map((t) => t.name),
      timingMs: Date.now() - startTime,
      error: "Could not determine result kind",
    };
  } finally {
    // @ts-expect-error - restoring global
    global.db = originalDb;
  }
}

/** Extract facts from a draft or tool call */
function extractFacts(draft: any): Record<string, string | number | boolean> {
  const facts: Record<string, string | number | boolean> = {};
  
  if (draft.kind === "create_invoice") {
    facts.kind = "create_invoice";
    if (draft.payload) {
      facts.customerId = draft.payload.customer?.id;
      facts.quantity = draft.payload.lines?.reduce((sum: number, line: any) => sum + (line.quantity || 0), 0);
      facts.unitPriceMinor = draft.payload.lines?.[0]?.unitPriceMinor;
      facts.totalMinor = draft.payload.totalMinor;
      facts.dueDate = draft.payload.dueDate;
    }
  } else if (draft.kind === "create_receipt") {
    facts.kind = "create_receipt";
    if (draft.payload) {
      facts.totalMinor = draft.payload.totalMinor;
      facts.method = draft.payload.method;
      facts.fulfilment = draft.payload.fulfilment;
      facts.stockAfter = draft.snapshot?.stockAfter?.[Object.keys(draft.snapshot?.stockAfter || {})[0]];
    }
  } else if (draft.kind === "record_invoice_payment") {
    facts.kind = "record_invoice_payment";
    if (draft.payload) {
      facts.invoiceId = draft.payload.invoiceId;
      facts.amountMinor = draft.payload.amountMinor;
      facts.createReceipt = draft.payload.createReceipt;
    }
  }
  // Add more kind handlers as needed
  
  return facts;
}

function extractFactsFromTools(tools: ScriptedCall[]): Record<string, string | number | boolean> {
  const facts: Record<string, string | number | boolean> = {};
  for (const tool of tools) {
    if (tool.name === "unpaid_invoices") {
      facts.from = (tool.args as any).from;
      facts.to = (tool.args as any).to;
    } else if (tool.name === "business_summary") {
      facts.period = (tool.args as any).period;
      facts.byItem = (tool.args as any).byItem;
    } else if (tool.name === "list_bookings") {
      facts.from = (tool.args as any).from;
      facts.to = (tool.args as any).to;
    }
  }
  return facts;
}

/**
 * Run all evaluation cases and return aggregate results.
 */
export async function evaluateCases(
  cases: EvaluationCase[] = EVALUATION_CASES,
  dependencies?: ModelDependencies,
): Promise<{
  passed: number;
  failed: Array<{ id: string; reason: string }>;
  estimatedCostUsd: string | null;
  timingsMs: number[];
}> {
  const results: Array<{ id: string; passed: boolean; reason?: string; timingMs: number }> = [];
  const timings: number[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const testCase of cases) {
    try {
      const result = await runEvaluationCase(testCase, dependencies);
      timings.push(result.timingMs);
      
      // Check if the result matches expected
      const passed = result.kind === testCase.expected.kind && 
        (result.tool === testCase.expected.tool || (testCase.expected.tool === null && !result.tool));
      
      if (passed) {
        // Verify facts
        const expectedFacts = testCase.expected.facts;
        for (const [key, expectedValue] of Object.entries(expectedFacts)) {
          const actualValue = result.normalizedFacts[key];
          if (actualValue !== expectedValue) {
            results.push({
              id: testCase.id,
              passed: false,
              reason: `Fact mismatch: ${key}=${actualValue} (expected ${expectedValue})`,
              timingMs: result.timingMs,
            });
            goto nextCase;
          }
        }
        
        // Verify forbidden writes
        if (testCase.expected.forbiddenWrites && result.domainWrites > 0) {
          results.push({
            id: testCase.id,
            passed: false,
            reason: `Forbidden writes detected: ${result.domainWrites}`,
            timingMs: result.timingMs,
          });
          goto nextCase;
        }
        
        results.push({
          id: testCase.id,
          passed: true,
          timingMs: result.timingMs,
        });
      } else {
        results.push({
          id: testCase.id,
          passed: false,
          reason: `Expected ${testCase.expected.kind}/${testCase.expected.tool}, got ${result.kind}/${result.tool}`,
          timingMs: result.timingMs,
        });
      }
    } catch (error) {
      results.push({
        id: testCase.id,
        passed: false,
        reason: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timingMs: 0,
      });
    }
    nextCase:;
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).map((r) => ({
    id: r.id,
    reason: r.reason || "Unknown reason",
  }));

  // Estimate cost (this would need actual token counts from the model)
  const estimatedCostUsd = null; // Would need actual pricing

  return {
    passed,
    failed,
    estimatedCostUsd,
    timingsMs: timings,
  };
}

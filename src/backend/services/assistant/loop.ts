import type OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming, ResponseInput, ResponseOutputItem, ResponseUsage } from "openai/resources/responses/responses";
import type { DraftDto } from "types/assistant";
import { assistantConfig, MAX_OUTPUT_TOKENS, MAX_ROUNDS } from "./config";
import { lagosDay } from "./clock";
import { getOpenAI } from "./openai";
import { HELP_REPLY, LOOKUP_REPLY, MULTI_ACTION_REPLY, SYSTEM_PROMPT } from "./prompt";
import { buildTools, dispatchTool, type ToolContext, type ToolDispatcher, type ToolOutcome } from "./tools/registry";
import type { StoredTurn } from "./types";
import type { UsageAccumulator } from "./usage";
import type { StoredClarification } from "./store";

export type ModelResponse = { output: ResponseOutputItem[]; usage: ResponseUsage | null; requestId?: string };
export type ResponsesTransport = (params: ResponseCreateParamsNonStreaming, options: { signal: AbortSignal }) => Promise<ModelResponse>;
export type ModelDependencies = { responses: Pick<OpenAI["responses"], "create">; dispatch: typeof dispatchTool };
export type ModelTurnInput = {
  context: ToolContext; text: string; history?: StoredTurn[];
  business: { name: string; currency: string; sells: string };
  usage: UsageAccumulator; transport?: ResponsesTransport; dispatch?: ToolDispatcher;
  editing?: { summary: string; originalRequest: unknown } | null;
  clarification?: StoredClarification | null;
};
export type ModelTurnResult = { reply: string; draft: DraftDto | null; toolRecords: StoredTurn["toolRecords"]; readPages?: string[] };

export const NARROW_REPORT_REPLY = "That report is too large for chat. Please choose one customer, item or shorter period.";
/** Keep every fact line intact and every UTF-16 unit, including separators. */
export function paginateReadText(text: string): string[] | null {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const pages: string[] = [];
  let page = "";
  for (const line of lines) {
    if (line.length > 3_500) return null;
    if (page.length + line.length > 3_500) { pages.push(page); page = ""; }
    page += line;
  }
  if (page) pages.push(page);
  return pages.length <= 32 ? pages : null;
}
export function readPageText(pages: string[], index: number): string {
  return `${pages[index] ?? ""}${pages.length > 1 ? `\n\nPage ${index + 1} of ${pages.length}.${index + 1 < pages.length ? " Reply next for more." : ""}` : ""}`;
}

export function clarificationText(outcome: Extract<ToolOutcome, { kind: "clarification" }>): string {
  return [outcome.question, ...outcome.choices.map((choice, index) => `${index + 1}. ${choice.label}`)].join("\n");
}

/** Enforce a caller-owned deadline even for a transport that ignores cancellation. */
export async function withinDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void work.catch(() => undefined); signal.throwIfAborted(); }
  let stop: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    stop = () => reject(new DOMException("Assistant deadline exceeded", "AbortError"));
    signal.addEventListener("abort", stop, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { if (stop) signal.removeEventListener("abort", stop); }
}

/** Only protocol output is continued; no reasoning or model prose enters durable history. */
export async function runModelTurn(input: ModelTurnInput, dependencies?: ModelDependencies): Promise<ModelTurnResult> {
  const { context, usage } = input;
  const dispatch = dependencies?.dispatch ?? input.dispatch ?? dispatchTool;
  const transport: ResponsesTransport = input.transport ?? (async (params, options) => {
    const responses = dependencies?.responses ?? getOpenAI().responses;
    const response = await responses.create(params, options);
    return { output: response.output, usage: response.usage ?? null, requestId: response._request_id ?? undefined };
  });
  const protocolItems: ResponseInput = [{ role: "user", content: JSON.stringify({
    business: { ...input.business, lagosDate: lagosDay(context.now) },
    recentHistory: input.history ?? [], editing: input.editing ?? null,
    pendingClarification: input.clarification ?? null,
    ownerRequest: input.text,
  }) }];
  const toolRecords: StoredTurn["toolRecords"] = [];
  const readTexts: string[] = [];
  let hadError = false;
  let recovery = LOOKUP_REPLY;
  let validationQuestion: string | undefined;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    context.signal.throwIfAborted();
    await context.checkCurrent?.();
    context.signal.throwIfAborted();
    let response: ModelResponse;
    try {
      response = await withinDeadline(transport({
        model: assistantConfig().model, instructions: SYSTEM_PROMPT, tools: buildTools(), input: [...protocolItems],
        reasoning: { effort: "low" }, parallel_tool_calls: false,
        max_output_tokens: MAX_OUTPUT_TOKENS, store: false,
      }, { signal: context.signal }), context.signal);
    } catch (error) { usage.markBillingUnknown(); throw error; }
    usage.addResponseUsage(response.usage, response.requestId);
    context.signal.throwIfAborted();
    // Preserve every output item in order, including the model's reasoning continuation.
    protocolItems.push(...response.output);
    const calls = response.output.filter((item) => item.type === "function_call");
    if (calls.filter((call) => call.name.startsWith("draft_")).length > 1) {
      return { reply: MULTI_ACTION_REPLY, draft: null, toolRecords };
    }
    if (!calls.length) break;
    for (const call of calls) {
      context.signal.throwIfAborted();
      await context.checkCurrent?.();
      context.signal.throwIfAborted();
      const outcome = await withinDeadline(dispatch(context, call.name, call.arguments), context.signal);
      context.signal.throwIfAborted();
      protocolItems.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(outcome) });
      // Store compact facts only. Full tool output stays in this bounded request.
      const concise = outcome.kind === "read" ? { kind: outcome.kind, text: outcome.text.slice(0, 2_000) }
        : outcome.kind === "draft" ? { kind: outcome.kind, draftId: outcome.draft.id }
        : outcome.kind === "clarification" ? { kind: outcome.kind, question: outcome.question }
        : outcome;
      toolRecords.push({ name: call.name, arguments: {}, output: concise });
      if (outcome.kind === "draft") return { reply: outcome.draft.summary, draft: outcome.draft, toolRecords };
      if (outcome.kind === "clarification") return { reply: clarificationText(outcome), draft: null, toolRecords };
      if (outcome.kind === "read") readTexts.push(outcome.text);
      if (outcome.kind === "error") { hadError = true; recovery = outcome.question ?? outcome.message; if (outcome.question) validationQuestion = outcome.question; }
    }
  }
  // The language model cannot write monetary facts or claim successful mutations.
  const greeting = /^(hi|hello|hey|thanks|thank you)[!.\s]*$/i.test(input.text.trim());
  if (validationQuestion) return { reply: validationQuestion, draft: null, toolRecords };
  if (readTexts.length) {
    const pages = paginateReadText([...new Set(readTexts)].join("\n\n"));
    return { reply: pages?.length ? readPageText(pages, 0) : NARROW_REPORT_REPLY, draft: null, toolRecords,
      ...(pages && pages.length > 1 ? { readPages: pages } : {}) };
  }
  return { reply: greeting && !hadError ? HELP_REPLY : recovery, draft: null, toolRecords };
}

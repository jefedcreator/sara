# Talk to Sara: Voice Notes and Plain-English Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let linked owners use WhatsApp voice notes, WhatsApp and Instagram sentences, and a web hold-to-talk panel to read business information and approve precisely described changes once.

**Architecture:** One server-side assistant calls a hand-written registry over Sara's domain services. PostgreSQL stores conversation turns, immutable action previews, approval results, message claims and usage reservations; the model can propose changes but cannot execute or approve them. Channel adapters and authenticated web routes share this service, with transcription before interpretation and all domain mutations committed atomically with approval.

**Tech Stack:** Next.js 15.5 App Router (`after()`), React 19, Prisma 6/PostgreSQL, Zod 4, official `openai` Node SDK/Responses API/Whisper, `music-metadata`, TanStack Query 5, Radix Dialog primitives, Tailwind 4 tokens, Vitest 4; Node 24 and Yarn 1.22.22.

**Spec:** `docs/superpowers/specs/2026-10-21-talk-to-sara-voice-notes-design.md`

## Global Constraints

- **OpenAI only**: `whisper-1` for speech-to-text and the Responses API with function tools. Use the official `openai` npm package.
- `OPENAI_ASSISTANT_MODEL` defaults to `gpt-5.4-mini`; reasoning effort starts at `low`. `OPENAI_TRANSCRIBE_MODEL` defaults to `whisper-1`.
- `OPENAI_API_KEY`, `OPENAI_ASSISTANT_MODEL`, `OPENAI_TRANSCRIBE_MODEL`, `ASSISTANT_ENABLED` and `ASSISTANT_DAILY_LIMIT` belong in both `src/env.js` and `.env.example`.
- `ASSISTANT_ENABLED` defaults on; `ASSISTANT_DAILY_LIMIT` defaults to 100 per business per day. No per-business opt-in or owner usage screen.
- Every assistant action that changes data requires approval of the exact code-written summary. Reads answer straight away. Sara always replies in text.
- Drafts expire after 24 hours; recent conversation lasts 30 minutes. A new draft replaces any older pending draft in the same conversation.
- Voice notes longer than 2 minutes are refused. Audio is thrown away after transcription. The transcript is kept with the request.
- The tool loop is capped at 6 rounds; requests stop at about 25 seconds; slow chat replies send “One moment…” after about 4 seconds.
- Voice-note replies start with `🎙️ "<transcript>"`, cut to about 200 characters.
- WhatsApp reply buttons: at most three buttons, titles up to 20 characters. Use **Send it** and **Change something**.
- Instagram is typed only. Typed `yes` or `send it` can approve on WhatsApp and Instagram; web approvals belong to their own conversation.
- `menu` and `0` retain the numbered menu; `cancel` also cancels the pending draft. Typed responses within a menu flow stay in that flow; a voice note leaves it.
- Chat money uses `formatMoney` from `src/backend/services/messaging/engine/amount.ts` (`NGN 45,000`). Catalog prices apply unless the owner explicitly states another price. Code computes money.
- The business comes from a linked identity or authenticated owner. Every referenced customer, item, document, order and booking must belong to it.
- Tools call `src/backend/services/*` directly. No internal HTTP calls, MCP server, OpenAPI-generated tools, Realtime/WebRTC, spoken replies, Instagram audio, customer WhatsApp messages, proactive suggestions or settings tools.
- Plain English only. No promise of Pidgin, Yoruba or other-language support. Product photos and hours, closures, bank details and Google Calendar settings remain web-only.
- UI follows `DESIGN.md` and `CLAUDE.md`: Tailwind tokens in `className`, `cn()`, 375px first, existing primitives, no inline design styles. Keep “AI” out of headlines and “Start on WhatsApp” as the primary landing CTA. Copy claims only what has shipped.
- Do not add attribution trailers to commits. `docs/` is ignored: add this plan and documentation with explicit `git add -f` paths.

---

## Planning baseline and choices

This is one integrated feature with independently testable tasks, rather than separate plans for each transport: all three surfaces depend on identical tools, previews and approvals. The merchant companion spec is already substantially implemented in this checkout: products/options/stock, customers/history, orders, product document lines and invoice payments exist. Do not replay its implementation plan.

The source spec still says “Draft design, awaiting the owner's approval,” and distinguishes approved decisions from “Calls I made (not discussed; check these).” This plan is a planning artifact, not evidence those calls were approved. It carries their defaults forward as explicit assumptions: model/effort, approval for every write, 24-hour drafts, 120-second audio, daily quota, 30-minute memory, Instagram text approvals, all-business availability and separate web conversations. Revisit these before launching; writing this plan does not require changing the source spec's status.

Builder choices locked for execution:

1. Store recent turns locally, with `store: false` on Responses calls. Replay complete protocol items within an active turn; store concise completed tool records for subsequent turns. Do not persist model reasoning or raw audio. Use no `previous_response_id` across owners or channels.
2. Scope each conversation by `(businessId, channel, principalId)`. A principal is a `ChatIdentity.id` for messaging and the signed-in `User.id` for WEB. Pending drafts and memory never cross this boundary.
3. `PENDING → APPROVED`, the domain mutation and the saved result commit together. Never commit “done” before running the mutation. A thrown error rolls back all of them. External PDF/email/calendar work occurs after commit; its failure never reruns the mutation.
4. Use bounded PostgreSQL serializable retries for transaction conflicts. Revalidate the frozen preview in the same transaction. A changed catalog price or relevant status invalidates the draft; it never silently changes the approved values.
5. A 100-request quota counts turns that can call OpenAI, across all channels. Plain button approval/change/cancel operations make no model call and do not consume that quota; log approval separately. The off switch disables new assistant turns and assistant approvals. The numbered menu keeps working.
6. Assistant numbered clarification choices take precedence over main-menu numbers while clarification is active. Voice that transcribes to “yes” does **not** approve a draft; only an actual button event, an exact typed approval or a web approval endpoint can do that.
7. An invoice or sale can include a new customer only if the summary explicitly includes that creation. Preview code must never call `customerService.resolve`, which can write. Search before every proposed customer/item creation.
8. Read reports use shared service data and deterministic formatted facts. The model may add a short sentence, but code renders amounts, counts and document links. No fabricated success response can override a pending action.
9. Audio has a 10 MiB streaming cap. Inspect duration using `music-metadata`; if a browser container lacks duration metadata, use Whisper's returned duration as the final check before any intent/tool processing. Never trust the client's reported duration.

### Evidence checked while planning

- The [official SDK guide](https://developers.openai.com/api/docs/libraries) documents the Node SDK installation. No `openai` package is installed here; resolve and pin its current version in Task 1 instead of assuming Standara's `^6.15.0` is current.
- Responses functions use strict schemas, `function_call_output` and matching `call_id`; disable parallel tool calls to simplify the one-draft protocol. See [function calling](https://developers.openai.com/api/docs/guides/function-calling).
- Preserve the spec's `gpt-5.4-mini` and `low` effort. They are supported by the [named model documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
- Whisper `verbose_json` provides text and duration. Use that response for the final length check; see [transcriptions](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).
- `music-metadata` supports buffer parsing and Ogg, WebM and MP4. Duration can be missing even with duration parsing enabled; see its [primary documentation](https://github.com/Borewit/music-metadata).

These are implementation references, not a claim about account access, guaranteed latency or the spec's monthly cost estimate. Pricing is a versioned operational input and is checked again before release.

## File map and dependency order

| Area | Files and responsibility |
| --- | --- |
| Shared wire types | `types/assistant.ts`, exported from `types/index.ts`: scope-free client DTOs, draft/result/turn types |
| Persistence | `prisma/schema.prisma`, a generated migration: conversations, turns, pending actions, usage/daily reservations, durable chat claims |
| Assistant foundation | `src/backend/services/assistant/{types,config,clock,store,usage,openai}.ts`: trusted scope, budgets, history, quotas and SDK transport |
| Shared reads | `src/backend/services/dashboard/index.ts`, `src/backend/services/documents/index.ts`: period/customer filters and document lookup |
| Read tools | `src/backend/services/assistant/tools/{schemas,reads,registry}.ts`: curated schemas, deterministic read results and dispatch |
| Shared writes | Existing invoice/receipt/order/product/customer services; new `invoice/mutations.ts`, `booking/mutations.ts`, `service/index.ts`: transaction-aware domain operations |
| Drafts | `src/backend/services/assistant/actions/{schemas,resolve,summary,execute,approve}.ts`: immutable payload, evidence, summary, recheck and atomic execution |
| Model turns | `src/backend/services/assistant/{prompt,loop,index}.ts`: bounded tool loop, memory and orchestration |
| Audio | `src/backend/services/assistant/audio.ts`, `messaging/channels/whatsapp/media.ts`: transient buffers, duration checks, transcription and authenticated download |
| Messaging | Existing channel `types.ts`, WhatsApp/Instagram adapters, `messaging/engine/index.ts`; new `messaging/assistant.ts` and `messaging/process.ts`: routing/presentation and post-response work |
| Web server | `src/backend/services/assistant/http.ts`; `/api/assistant/messages`, `/api/assistant/drafts/[id]/{approve,change}` routes: owner authentication and bounded input |
| Web client | `src/utils/{api,audio-recorder}.ts`, `src/hooks/use-voice-recorder.ts`, `src/hooks/mutations/use-assistant-mutations.ts`, `src/components/assistant/*`, `app-chrome.tsx`: recording and panel |
| Verification | Colocated `.test.ts` files, `src/backend/services/assistant/approval.integration.test.ts`, `evals/assistant/{cases,fixtures}.ts`, `scripts/eval-assistant.ts` |
| Launch docs/copy | `PRODUCT.md`, `DESIGN.md`, actual `src/app/components/landing/*`, `docs/assistant-operations.md` |

Tasks 1–4 establish guarded reads; 5–8 expose shared transaction-safe writes; 9–12 deliver drafts and model turns; 13–16 connect audio and messaging; 17–19 add the web surface; 20–21 verify and document release. Do not expose a partially completed write tool. Implement in order, with only independent tests/documentation parallelized.

## Task 1: Add an optional OpenAI transport with safe configuration

**Files:** Modify `package.json`, `yarn.lock`, `src/env.js`, `.env.example`; create `src/backend/services/assistant/config.ts`, `openai.ts`, `config.test.ts`, `openai.test.ts`.

**Interfaces:** Produce `assistantConfig(): { enabled: boolean; available: boolean; dailyLimit: number; model: string; transcribeModel: string }` and lazy `getOpenAI(): OpenAI`. Export `TURN_TIMEOUT_MS = 25_000`, `MAX_ROUNDS = 6`, `MAX_OUTPUT_TOKENS = 2_000`, `MAX_AUDIO_SECONDS = 120`, `MAX_AUDIO_BYTES = 10 * 1024 * 1024` from `config.ts`.

- [ ] **Step 1: Write configuration and lazy-client tests.** Mock `@/env` and the SDK constructor; assert a missing key does not break imports or the numbered menu.

```ts
it("parses the off switch explicitly", async () => {
  vi.stubEnv("ASSISTANT_ENABLED", "false");
  vi.resetModules();
  const { readAssistantSettings } = await import("./config");
  expect(readAssistantSettings(process.env).enabled).toBe(false);
});
it("rejects a zero daily limit", async () => {
  const { readAssistantSettings } = await import("./config");
  expect(() => readAssistantSettings({ ASSISTANT_DAILY_LIMIT: "0" })).toThrow();
});
```

- [ ] **Step 2: Run `yarn test src/backend/services/assistant/config.test.ts src/backend/services/assistant/openai.test.ts`.** Expect missing-module/export failures before implementation.
- [ ] **Step 3: Resolve dependencies and implement settings/transport.** Run `yarn info openai version --json`, then `yarn add --exact openai@latest music-metadata@latest`. Record resolved versions in the task commit; the lockfile is authoritative. Mirror the following schema in `src/env.js` and add each key to `runtimeEnv`:

```ts
const enabled = z.enum(["true", "false"]).default("true")
  .transform((value) => value === "true");
const settingsSchema = z.object({
  OPENAI_API_KEY: z.string().trim().optional(),
  OPENAI_ASSISTANT_MODEL: z.string().trim().min(1).default("gpt-5.4-mini"),
  OPENAI_TRANSCRIBE_MODEL: z.string().trim().min(1).default("whisper-1"),
  ASSISTANT_ENABLED: enabled,
  ASSISTANT_DAILY_LIMIT: z.coerce.number().int().positive().default(100),
});
export function readAssistantSettings(raw: Record<string, unknown>) {
  const value = settingsSchema.parse(raw);
  return {
    enabled: value.ASSISTANT_ENABLED,
    available: value.ASSISTANT_ENABLED && Boolean(value.OPENAI_API_KEY),
    dailyLimit: value.ASSISTANT_DAILY_LIMIT,
    model: value.OPENAI_ASSISTANT_MODEL,
    transcribeModel: value.OPENAI_TRANSCRIBE_MODEL,
  };
}
```

`assistantConfig()` maps validated `env` directly; do not reparse its already-transformed boolean with the string enum. `readAssistantSettings()` is the raw-input test seam. `getOpenAI()` instantiates only on demand, with `maxRetries: 0` and `timeout: TURN_TIMEOUT_MS`; all calls additionally receive the turn's `AbortSignal`. Do not expose credentials through public environment variables. `.env.example` uses `OPENAI_API_KEY=""`, the named model defaults, `ASSISTANT_ENABLED="true"`, `ASSISTANT_DAILY_LIMIT="100"`.
- [ ] **Step 4: Run the two test files, `yarn typecheck` and `yarn lint`.** Expect defaults, false parsing, unavailable-key behavior and zero SDK retries to pass. Dependency installation is not permission to make a live OpenAI request.
- [ ] **Step 5: Commit** with `git add package.json yarn.lock src/env.js .env.example src/backend/services/assistant` and `git commit -m "feat(assistant): add guarded OpenAI transport"`.

## Task 2: Persist scoped conversations, turns and durable message claims

**Files:** Modify `prisma/schema.prisma`, `src/backend/services/messaging/session/index.ts`, `session/index.test.ts`; create a migration named `assistant_foundation`, `types/assistant.ts`, `src/backend/services/assistant/types.ts`, `store.ts`, `store.test.ts`; export wire types from `types/index.ts`.

**Interfaces:** Produce these shared contracts. Client DTOs omit business/principal IDs and internal payloads.

```ts
export type AssistantScope = {
  businessId: string;
  channel: "WHATSAPP" | "INSTAGRAM" | "WEB";
  principalId: string;
};
export type DraftDto = {
  id: string; summary: string; expiresAt: string;
  status: "PENDING" | "APPROVED" | "CANCELLED" | "EXPIRED" | "REPLACED" | "INVALID";
};
export type ResourceKind = "invoices" | "receipts" | "orders" | "products"
  | "services" | "bookings" | "customers" | "dashboard";
export type ActionResult = {
  text: string; resourceId: string; link: string | null; affected: ResourceKind[];
};
export type AssistantReply = {
  conversationId: string; requestId: string; transcript: string | null;
  reply: string; draft: DraftDto | null; result: ActionResult | null;
};
export type ApprovalReply = {
  status: "approved" | "already_done" | "expired" | "changed" | "cancelled";
  reply: string; result: ActionResult | null; draft: DraftDto | null;
};
```

`store.ts` exports `getConversation(scope): Promise<AssistantConversation>`, `assertConversation(scope, id): Promise<AssistantConversation>`, `loadRecent(scope, now): Promise<StoredTurn[]>`, `resetMemory(scope): Promise<void>`, `claimTurn(scope, requestId): Promise<"claimed" | "busy" | AssistantReply>`, `saveTurn(scope, requestId, turn): Promise<void>`, `releaseTurn(scope, requestId): Promise<void>`, and `getAction(scope, id): Promise<AssistantAction>` for internal draft context. Define `StoredTurn` with `userText: string`, `transcript: string | null`, `reply: string`, `toolRecords: {name: string; arguments: Prisma.JsonValue; output: Prisma.JsonValue}[]`, `createdAt: Date`; JSON fields are validated before reading. Keep `AssistantScope` and internal Prisma payloads in backend `types.ts`; re-export the client-safe DTOs from `types/assistant.ts` instead of declaring competing versions.

- [ ] **Step 1: Add scope and interleaved-dedup regression tests** using mocked `@/server/db`, following `session/index.test.ts`.

```ts
it("claims interleaved message IDs only once", async () => {
  const seen = new Set<string>();
  vi.mocked(db.processedChatMessage.create).mockImplementation(async ({ data }) => {
    const key = `${data.sessionId}:${data.messageId}`;
    if (seen.has(key)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
    seen.add(key);
    return data as never;
  });
  expect(await chatSessionService.claimMessage("s1", "m1")).toBe(true);
  expect(await chatSessionService.claimMessage("s1", "m2")).toBe(true);
  expect(await chatSessionService.claimMessage("s1", "m1")).toBe(false);
});
```

Also assert foreign business, principal and channel all fail `assertConversation`; 29-minute history survives, 31-minute history is omitted; reset clears clarification/history without expiring a 24-hour draft.
- [ ] **Step 2: Run `yarn test src/backend/services/assistant/store.test.ts src/backend/services/messaging/session/index.test.ts`.** Expect absent delegates and store functions to fail.
- [ ] **Step 3: Add the models and repository methods.** Use Prisma enum `AssistantChannel` including WEB; leave `ChatChannel` unchanged. Add Business back-relations and a ChatSession back-relation for processed messages.

| Model | Required columns and constraints |
| --- | --- |
| `AssistantConversation` | cuid id; business relation/cascade; channel; principalId; `lastActiveAt`; `memoryVersion Int @default(0)`; `clarification Json?`; `editingActionId String?`; `leaseToken String?`; `leaseExpiresAt DateTime?`; unique business/channel/principal |
| `AssistantTurn` | id; conversation relation/cascade; requestId; memoryVersion; userText default empty until parsed/transcribed; transcript nullable; toolRecords JSON default []; reply JSON nullable; state RUNNING/DONE/ERROR; createdAt; unique conversation/requestId; index conversation/createdAt |
| `AssistantAction` | id; conversation relation/cascade; businessId; kind; payload JSON; snapshot JSON; summary; status PENDING/APPROVED/CANCELLED/EXPIRED/REPLACED/INVALID; result JSON nullable; createdAt; expiresAt; approvedAt nullable; index conversation/status |
| `AssistantUsage` | id; conversation relation/cascade; businessId; requestId; channel; mode VOICE/TEXT/APPROVAL; audioSeconds nullable; model; inputTokens/cachedTokens/outputTokens default 0; estimatedCostUsd Decimal(14,8) nullable; pricingVersion nullable; durationMs default 0; outcome default running; providerRequestIds JSON default []; createdAt; unique conversation/requestId |
| `AssistantDailyUsage` | business relation/cascade; `day String` (Lagos YYYY-MM-DD); count default 0; composite primary key businessId/day |
| `ProcessedChatMessage` | id; session relation/cascade; messageId; createdAt; unique sessionId/messageId |

Add a partial unique SQL index so each conversation has at most one PENDING action:

```sql
CREATE UNIQUE INDEX "AssistantAction_one_pending"
ON "AssistantAction" ("conversationId") WHERE "status" = 'PENDING';
```

`claimMessage` inserts its durable claim; return false **only** for P2002, rethrow database outages. Keep updating `lastProcessedMsgId` for compatibility, but never use it as the deduplication guarantee. Existing claim rows have no destructive short retention.

Acquire the conversation lease atomically for 30 seconds before model work; competing turns receive “I'm still working on your last request. Try again in a moment.” Update `memoryVersion` on menu/reset/cancel. A completing turn whose version changed cannot publish a draft. Store at most 12 completed recent turns and 16,000 characters of historical content, dropping whole oldest turns. A live lease outlives the 25-second model deadline and is cleared in `finally`.

Run `yarn prisma migrate dev --create-only --name assistant_foundation`, review the generated migration and add the partial index, then `yarn prisma migrate dev` and `yarn prisma generate` against the development database. Do not run migrations against production while executing feature tasks.
- [ ] **Step 4: Run the two test files and `yarn prisma validate`, `yarn typecheck`, `yarn lint`.** Test that a duplicate web request returns its stored reply without a new turn or model call.
- [ ] **Step 5: Commit** the schema, generated migration, shared types, store and session changes with `feat(assistant): persist scoped turns and durable claims`.

## Task 3: Bound paid work and record usage before enabling assistant traffic

**Files:** Create `src/backend/services/assistant/usage.ts`, `usage.test.ts`, `clock.ts`, `clock.test.ts`.

**Interfaces:** Produce `lagosDay(now): string`, `periodRange(period, now): {from: Date; to: Date}`, where period is `today | week | month`; `reserveUsage(scope, requestId, mode, now): Promise<{id: string} | null>`; `finishUsage(id, patch): Promise<void>`; `recordApprovalUsage(scope, actionId, startedAt, outcome): Promise<void>`; `estimateCost(input): {usd: string | null; pricingVersion: string | null}`. `patch` includes summed tokens, seconds, provider IDs, elapsed milliseconds and outcome answered/draft/approved/error/denied. Export `UsageAccumulator` with zero initial counters and `addResponseUsage(usage)`.

- [ ] **Step 1: Add midnight and cost tests**, and a quota test with an injected transaction client that returns no row when its conditional increment loses.

```ts
it("uses the Lagos date even before UTC midnight", () => {
  expect(lagosDay(new Date("2026-11-03T23:30:00Z"))).toBe("2026-11-04");
  expect(periodRange("week", new Date("2026-11-04T12:00:00Z"))).toEqual({
    from: new Date("2026-11-01T23:00:00Z"),
    to: new Date("2026-11-08T23:00:00Z"),
  });
});
it("does not charge cached tokens at the uncached rate", () => {
  const result = estimateCost({ model: "gpt-5.4-mini", input: 1000,
    cached: 400, output: 100, audioSeconds: 0 });
  expect(result.usd).toBe("0.00093000");
});
```

- [ ] **Step 2: Run `yarn test src/backend/services/assistant/usage.test.ts src/backend/services/assistant/clock.test.ts`.** Expect missing exports to fail.
- [ ] **Step 3: Implement atomic reservation and accounting.** Within a short transaction, first create the unique usage row and then conditionally increment the business/day row; roll back both when the cap is reached. A duplicate request retrieves the existing reservation and cannot increment again.

```ts
const rows = await tx.$queryRaw<{ count: number }[]>`
  INSERT INTO "AssistantDailyUsage" ("businessId", "day", "count")
  VALUES (${scope.businessId}, ${lagosDay(now)}, 1)
  ON CONFLICT ("businessId", "day") DO UPDATE
  SET "count" = "AssistantDailyUsage"."count" + 1
  WHERE "AssistantDailyUsage"."count" < ${assistantConfig().dailyLimit}
  RETURNING "count"
`;
if (rows.length === 0) throw new Error("ASSISTANT_LIMIT_REACHED");
```

Use `Intl.DateTimeFormat(..., {timeZone: "Africa/Lagos"}).formatToParts` for day keys; construct midnight at `+01:00` and use UTC arithmetic for Monday/week and month boundaries. No host-local `setHours`. Default rates for the spec's model are input 0.75, cached 0.075 and output 4.50 USD/million; Whisper is a separately checked USD/minute rate. Confirm both on the official pricing page during execution and store a pricing version/date. An unknown configured model logs `estimatedCostUsd: null`, never zero. Sum every completed Responses round and transcription usage even when a later round errors; keep unknown/aborted billing marked unknown.

Check enabled/available before reserving or downloading audio. Quota denial makes no OpenAI call. Use a bounded context, 6 rounds, 2,000 output tokens per response and SDK retries zero to make the daily request cap a useful cost bound. `recordApprovalUsage` upserts an APPROVAL row keyed by `approve:<actionId>` without incrementing the AI-turn count; its model field is `none` and estimated cost zero because it makes no paid call.
- [ ] **Step 4: Run these tests, including concurrent reservations, off/missing-key denial, duplicate IDs, cached usage, unknown model, failed transcription accounting and Lagos month rollover.** Run `yarn typecheck` and `yarn lint`.
- [ ] **Step 5: Commit** `src/backend/services/assistant/{usage,clock}*` with `feat(assistant): enforce daily budgets and usage accounting`.

## Task 4: Expose shared filtered reads and deterministic read tools

**Files:** Modify `src/backend/services/dashboard/index.ts`, `index.test.ts`; create `src/backend/services/documents/index.ts`, `index.test.ts`, `src/backend/services/assistant/tools/schemas.ts`, `reads.ts`, `reads.test.ts`.

**Interfaces:** Add backward-compatible `dashboardService.unpaidInvoices(businessId, limit?, filters?)`, `bookingsInRange(businessId, range)`, `summaryForPeriod(businessId, range)`, and optional range to `revenueByItem`. Filters are `{customerId?: string; from?: Date; to?: Date}` and unpaid periods refer to `dueAt`. Existing `todayBookings`, `summary`, `load` and menu reads delegate to these shared queries with Lagos ranges. Add `documentService.find(businessId, kind, number)` for invoice/receipt/order number lookup, returning owned id/publicId/number/status/currency/amounts/lines or null.

`executeRead(scope, request, now): Promise<{data: JsonValue; text: string}>` validates `request` using this discriminated read schema inventory (all objects strict):

| `name` | Arguments | Implementation |
| --- | --- | --- |
| `find_customers` | query string 1–255 | `customerService.list(businessId, {query, page:1, size:3})`; return IDs and distinguishers |
| `get_customer` | customerId | `customerService.detail`; history/spent/owed |
| `list_items` | query nullable, includeInactive boolean | owned services + `productService.list`; option IDs, effective prices, stock and units |
| `unpaid_invoices` | customerId nullable, period today/week/month/all | shared filtered `unpaidInvoices`, total count/outstanding independent of displayed cap |
| `list_bookings` | from/to ISO dates | shared range query, at most 31 days; show start/end events consistently with dashboard |
| `orders_to_send` | no arguments | `dashboardService.ordersToSendOut` |
| `business_summary` | period today/week/month, byItem boolean | shared period summary/revenueByItem |
| `find_document` | kind invoice/receipt/order, number | `documentService.find` |
| `share_link` | kind service/product, id | owned active item and `serviceLink`/`productLink` from `@/server/share` |

Use actual complete DB results for totals, not the first ten displayed rows. Return pagination/truncation wording rather than claiming a capped list is complete. Cap tool-output text at 8,000 characters, individual lists at 20 and query ranges at 31 days. IDs are strings; resolve and validate ownership server-side before returning data.

- [ ] **Step 1: Add shared-query and tool tests**, using existing dashboard/customer fixtures rather than parsing `intentDispatcher` strings.

```ts
it("looks up a document within the trusted business", async () => {
  vi.mocked(db.invoice.findFirst).mockResolvedValue(null);
  expect(await documentService.find("biz_a", "invoice", "INV-1042")).toBeNull();
  expect(db.invoice.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { businessId: "biz_a", invoiceNumber: "INV-1042" },
  }));
});
it("rejects a business override in tool arguments", () => {
  expect(() => readRequestSchema.parse({
    name: "get_customer", customerId: "cus_1", businessId: "biz_other",
  })).toThrow();
});
```

- [ ] **Step 2: Run `yarn test src/backend/services/dashboard src/backend/services/documents src/backend/services/assistant/tools/reads.test.ts`.** Expect missing service/filter failures.
- [ ] **Step 3: Implement shared service filters and render facts in code.** Keep existing return shapes/default arguments compatible; add typed aggregate metadata for the assistant rather than changing menu strings. For every request schema define an explicit discriminated member and z.infer type in `tools/schemas.ts`.

```ts
const invoice = await db.invoice.findFirst({
  where: { businessId, invoiceNumber: number },
  include: { lines: { orderBy: { position: "asc" } } },
});
// In the unpaid renderer, amounts are service results, not model text:
const text = invoices.map((row, index) =>
  `${index + 1}. ${row.invoiceNumber} · ${row.clientName} · ${formatMoney(row.outstanding, row.currency)}`,
).join("\n");
```

Service/product lookup must not implicitly create customers or change stock. Exclude banking/calendar tokens and unrelated customer records from tool output. Define `JsonValue` as Prisma's JSON value type internally; serialize Decimal and Date to strings deliberately.
- [ ] **Step 4: Run those tests and existing `src/app/api/dashboard/route.test.ts` plus messaging dispatch tests.** Include Lagos boundaries, unpaid due-period/customer filters, no-match, ambiguity, document-number kinds, product option prices, held stock and foreign IDs; run typecheck/lint.
- [ ] **Step 5: Commit** with `feat(assistant): add scoped business read tools`.

## Task 5: Make invoice and receipt creation usable inside an approval transaction

**Files:** Modify `src/backend/services/invoice/index.ts`, `index.test.ts`, `src/backend/services/receipt/index.ts`, `index.test.ts`; create `invoice/finalize.ts`, `receipt/finalize.ts`, with colocated tests. Preserve `src/backend/services/lines/index.ts` and existing creation routes as callers of the same domain code.

**Interfaces:** Retain `invoiceService.create(input: CreateInvoiceInput): Promise<Invoice>` and `receiptService.create(input: CreateReceiptInput): Promise<Receipt>`. Add `createInTransaction(tx: Prisma.TransactionClient, input)` to each, returning its document with business and ordered lines included; export these return types as `CreatedInvoice` and `CreatedReceipt` using Prisma payload types and the existing include objects. Add `finalizeInvoice(id): Promise<void>` and `finalizeReceipt(id): Promise<void>` for PDF generation/upload only. Export `Effect = { kind: "invoice_pdf" | "receipt_pdf" | "invoice_email" | "receipt_email" | "order_email" | "booking_sync"; id: string; previousStartTime?: string }` in assistant `types.ts` for later post-commit execution.

- [ ] **Step 1: Add a transaction-boundary regression test.** Extend the current transaction-client mocks with an outer marker; run both creation cores with that client.

```ts
it("creates through the supplied transaction without opening another", async () => {
  const tx = vi.mocked(db.$transaction).mock.calls.length;
  const input: CreateInvoiceInput = {
    businessId: "biz_1", name: "Tolu", currency: "NGN", status: "SENT",
    subtotal: 90000, taxAmount: 0, discount: 0, total: 90000, amountPaid: 0,
    lines: [{ name: "Frontal wig", quantity: 2, unitPrice: 45000, total: 90000 }],
  };
  await invoiceService.createInTransaction(db as never, input);
  expect(db.$transaction).toHaveBeenCalledTimes(tx);
  expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
});
```

Use existing fixture setup for business/customer/document rows. Add the receipt counterpart asserting `orderService.createFromReceipt` receives the supplied transaction and runs once.
- [ ] **Step 2: Run `yarn test src/backend/services/invoice/index.test.ts src/backend/services/receipt/index.test.ts`.** Expect missing core-method failures.
- [ ] **Step 3: Extract the transaction bodies and finalizers.** Move current logic without changing menu/dashboard defaults. All reads, number allocation, customer resolution, lines, receipt/order/payment and stock changes in a core use `tx`; finalizers load the committed document independently.

```ts
async create(input: CreateInvoiceInput): Promise<Invoice> {
  const invoice = await db.$transaction((tx) => this.createInTransaction(tx, input));
  await finalizeInvoice(invoice.id);
  return (await db.invoice.findUnique({ where: { id: invoice.id } })) ?? invoice;
}
```

Use the equivalent wrapper for receipts. Finalizers retain current best-effort PDF behavior and deterministic Cloudinary public IDs. They cannot create a document or change stock. For assistant document numbering use serializable retry at approval (Task 11), retaining the existing unique per-business number constraints. Do not silently replace existing menus with the assistant.
- [ ] **Step 4: Run invoice/receipt service tests, `src/app/api/invoices/[slug]/route.test.ts`, `src/app/api/receipts/[slug]/route.test.ts`, and messaging dispatch tests**, then typecheck/lint. Verify a PDF failure leaves one committed document and its public link usable.
- [ ] **Step 5: Commit** with `refactor(documents): expose transactional creation cores`.

## Task 6: Extract shared manual invoice payment and void operations

**Files:** Create `src/backend/services/invoice/mutations.ts`, `mutations.test.ts`; modify `src/app/api/invoices/[slug]/route.ts`, its tests, `src/backend/services/order/index.ts`, `index.test.ts`, and `src/backend/services/invoice/payment.test.ts` only where shared behavior gains regression coverage.

**Interfaces:** Produce `invoiceMutations.updateInTransaction(tx, businessId, slug, patch: UpdateInvoiceValidatorSchema): Promise<InvoiceMutation>` and `invoiceMutations.update(businessId, slug, patch): Promise<Invoice>`; `InvoiceMutation = { invoice: CreatedInvoice; effects: Effect[] }`. Add `recordPaymentInTransaction(tx, businessId, invoiceId, input: {amountMinor: number; method: "CASH" | "BANK_TRANSFER"; createReceipt: boolean; paidAt: Date}): Promise<{invoice: CreatedInvoice; receiptId: string | null; effects: Effect[]}>`. `amountMinor` is an additional payment, never a replacement `amountPaid` value. Extract `orderService.setStatusInTransaction(tx, businessId, slug, to: OrderStatusChange): Promise<{order: OrderSummary; effects: Effect[]}>` here so invoice void/cancellation has no forward dependency on Task 8.

- [ ] **Step 1: Add manual-payment and void tests.** Reuse invoice fixtures and a mocked transaction client; explicitly assert outstanding-balance checks and atomic first-payment order creation.

```ts
it("rejects a payment above the current balance", async () => {
  vi.mocked(db.invoice.findFirst).mockResolvedValue({
    id: "inv_1", businessId: "biz_1", status: "PARTIALLY_PAID",
    total: new Prisma.Decimal(90000), amountPaid: new Prisma.Decimal(60000),
  } as never);
  await expect(invoiceMutations.recordPaymentInTransaction(db as never, "biz_1", "inv_1", {
    amountMinor: 4_000_000, method: "CASH", createReceipt: false,
    paidAt: new Date("2026-11-04T10:00:00Z"),
  })).rejects.toThrow("outstanding");
  expect(db.payment.create).not.toHaveBeenCalled();
});
```

Add cases for partial/full payment, optional receipt, foreign invoice, PAID/VOID rejection, invoice cancellation with stock return, and a second payment not creating another order.
- [ ] **Step 2: Run `yarn test src/backend/services/invoice/mutations.test.ts src/app/api/invoices/`.** Expect missing mutation-service failures.
- [ ] **Step 3: Move existing route business logic to the shared core and add the additional-payment operation.** Perform all invoice status/ownership reads inside `tx`. Keep PAID final, preserve PARTIALLY_PAID editable-field restrictions, forbid overpayment and use `Prisma.Decimal` or integer minor units for arithmetic.

```ts
const nextPaid = invoice.amountPaid.plus(new Prisma.Decimal(input.amountMinor).div(100));
const status = nextPaid.eq(invoice.total) ? "PAID" : "PARTIALLY_PAID";
const payment = await tx.payment.create({ data: {
  businessId, invoiceId: invoice.id, customerId: invoice.customerId,
  amount: new Prisma.Decimal(input.amountMinor).div(100),
  method: input.method,
} });
const updated = await tx.invoice.update({
  where: { id: invoice.id },
  data: { amountPaid: nextPaid, status, paidAt: status === "PAID" ? input.paidAt : null },
  include: { business: true, lines: { include: { service: true }, orderBy: { position: "asc" } } },
});
```

Use `orderService.createFromInvoice(tx, invoice.id)` once when first money arrives. If requested, call the receipt transaction core with `paymentId`, so it does not create another sale/order. Payment has no currency column: its invoice/business supplies currency. Invoice void plus optional order cancellation/stock return shares the same transaction via the order core extracted in this task. Route `PUT` does session ownership checks, then calls `invoiceMutations.update`; it retains its response envelope. Existing verified Paystack processing stays in `invoice/payment.ts` and must keep its late-payment semantics.
- [ ] **Step 4: Run mutation, existing invoice/payment, order/payment and invoice route tests**, then typecheck/lint. Verify the extracted order-status wrapper retains post-commit email behavior and Task 6 passes independently.
- [ ] **Step 5: Commit** with `refactor(invoices): share manual payment and void operations`.

## Task 7: Extract booking and service mutations from HTTP handlers

**Files:** Create `src/backend/services/booking/mutations.ts`, `mutations.test.ts`, `src/backend/services/service/index.ts`, `index.test.ts`; modify `src/app/api/bookings/[slug]/route.ts`, `src/app/api/services/route.ts`, `src/app/api/services/[slug]/route.ts` and their existing tests. Create a service POST route test if none exists.

**Interfaces:** Produce `bookingMutations.updateInTransaction(tx, businessId, slug, patch: UpdateBookingValidatorSchema): Promise<{booking: Booking; effects: Effect[]}>`, `bookingMutations.update(businessId, slug, patch): Promise<Booking>`, and `bookingMutations.finalize(effect: Effect): Promise<void>`. Produce `serviceService.createInTransaction(tx, businessId, input: Omit<ServiceValidatorSchema, "image">, imageUrl: string | null): Promise<Service>` and `updateInTransaction(tx, businessId, slug, patch: Omit<UpdateServiceValidatorSchema, "image">): Promise<Service>`; keep uploads in web route/wrapper code, outside transactional operations.

- [ ] **Step 1: Add booking transition and conflict tests.** Copy existing route fixtures into the service test; use the same `bookingTerms` and `blockingBookingsWhere` behavior.

```ts
it("does not reschedule into another booking", async () => {
  vi.mocked(db.booking.findFirst)
    .mockResolvedValueOnce({
      id: "b1", slug: "b1", businessId: "biz_1", status: "CONFIRMED",
      startTime: new Date("2026-11-04T09:00:00Z"), units: 1,
      service: { id: "s1", bookingMode: "SLOT", duration: 60, price: 10000 },
    } as never)
    .mockResolvedValueOnce({ id: "b2" } as never);
  await expect(bookingMutations.updateInTransaction(db as never, "biz_1", "b1", {
    startTime: new Date("2026-11-04T11:00:00Z"),
  })).rejects.toThrow();
  expect(db.booking.update).not.toHaveBeenCalled();
});
```

Use the validator's actual inferred Date type when writing the test; do not pass unparsed HTTP strings to the service core. Add invalid transitions, foreign service/booking, nightly/daily duration preservation, pausing a service and service-name conflicts.
- [ ] **Step 2: Run `yarn test src/backend/services/booking/mutations.test.ts src/backend/services/service src/app/api/bookings/ src/app/api/services/`.** Expect missing exports.
- [ ] **Step 3: Extract the current logic into transaction-aware methods.** Read ownership/status inside `tx`. Preserve PENDING→CONFIRMED/CANCELLED, CONFIRMED→COMPLETED/CANCELLED and terminal statuses; reuse booking term calculation and overlap checks. Move email and Google Calendar update/delete work into post-commit finalization.

```ts
const updated = await tx.booking.update({ where: { id: booking.id }, data });
return {
  booking: updated,
  effects: [{ kind: "booking_sync", id: updated.id,
    previousStartTime: booking.startTime.toISOString() }],
};
```

`data` is the validated patch assembled by the moved route logic, with calculated endTime rather than model-supplied duration. Shared service create/update methods reuse existing validators, slug generation and booking setup checks. Assistant catalog schemas expose descriptive fields/price/pause and required booking terms only; do not expose bank, business-hours, closure or calendar-connection fields. Service-specific availability needed to create a valid service must be asked for and displayed.
- [ ] **Step 4: Run these service and route tests plus booking terms/conflicts tests**, then typecheck/lint. Assert no email/calendar/upload occurs before transaction commit and that existing dashboard updates still trigger their expected effects.
- [ ] **Step 5: Commit** with `refactor(services): share booking and catalog mutations`.

## Task 8: Make product, stock, order and customer writes transaction-safe

**Files:** Modify `src/backend/services/{product,order,customer}/index.ts` and tests, `src/backend/services/product/stock.ts`, `stock.test.ts`; create `src/backend/services/assistant/transaction.ts`, `transaction.test.ts`.

**Interfaces:** Add `productService.createInTransaction(tx, businessId, input: ProductInput, photos: string[])`, `updateInTransaction(tx, businessId, slug, patch: ProductUpdateInput)`, `adjustStockInTransaction(tx, businessId, optionId, change: StockChange)`; consume `orderService.setStatusInTransaction` from Task 6; add `customerService.updateInTransaction(tx, businessId, id, patch: UpdateCustomerInput)` and `createInTransaction(tx, input: CustomerInput)`. Add `requireAvailableStock(tx, businessId, lines: StockLine[], now): Promise<void>` and `withSerializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>`.

- [ ] **Step 1: Add strict-stock and rollback tests.** Preserve all existing paid-online oversold fixtures; test a new assistant cash sale separately.

```ts
it("refuses a new sale when a checkout holds the remaining stock", async () => {
  vi.mocked(db.productOption.findMany).mockResolvedValue([
    { id: "opt_1", stock: 3, product: { businessId: "biz_1", tracksStock: true } },
  ] as never);
  vi.mocked(db.orderLine.groupBy).mockResolvedValue([
    { productOptionId: "opt_1", _sum: { quantity: 2 } },
  ] as never);
  await expect(requireAvailableStock(db as never, "biz_1", [
    { productOptionId: "opt_1", quantity: 2 },
  ], new Date())).rejects.toThrow("stock");
});
```

Adapt mocks to the existing `availableStock` query shape, preserving the asserted two-held/three-total behavior. Also test remove below zero, foreign option, two concurrent updates, cancelled-order restock once and duplicate customer normalized phone/email.
- [ ] **Step 2: Run `yarn test src/backend/services/product src/backend/services/order src/backend/services/customer src/backend/services/assistant/transaction.test.ts`.** Expect missing transaction entry points.
- [ ] **Step 3: Extract each mutator into its supplied-client core and retain public wrappers.** Every helper called by a core, including unique-slug lookup and customer contact normalization, must use `tx` rather than global `db`. Customer create searches exact normalized phone/email and name before inserting; an existing matching record returns a clarification/conflict rather than silently editing it. Preserve explicit customer update semantics.

```ts
export async function withSerializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 5_000,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)
        || error.code !== "P2034" || attempt === 2) throw error;
    }
  }
  throw new Error("Transaction retry exhausted");
}
```

`requireAvailableStock` sums duplicate option lines, checks ownership/activity and `availableStock` including live holds, then runs within the same serializable transaction as the receipt/order stock decrement. A conditional stock update protects against negative/lost updates. The assistant strict path rejects insufficient stock and rolls back; existing verified-money `takeStock` still permits an oversold order. If concurrent document-number uniqueness raises P2002 for the **number constraint only**, retry that transaction up to the same bound; do not retry customer uniqueness as document numbering.

Order cancellation returns stock inside its core; emails run after commit. Product creation from chat passes `photos: []`, never model URLs. Keep web photo uploads and existing public wrappers working.
- [ ] **Step 4: Run all affected service tests plus products/orders/customers API tests**, then typecheck/lint. Add a regression that a failing assistant sale leaves zero new receipt/order/payment rows and unchanged stock; Task 20 repeats this against PostgreSQL.
- [ ] **Step 5: Commit** with `refactor(merchants): support atomic assistant mutations`.

## Task 9: Validate proposed actions and resolve immutable business snapshots

**Files:** Create `src/backend/services/assistant/actions/schemas.ts`, `resolve.ts`, `resolve.test.ts`, `amount.ts`, `amount.test.ts`.

**Interfaces:** Produce `draftRequestSchema`, `DraftRequest = z.infer<typeof draftRequestSchema>`, `resolveDraft(tx, scope, request, evidence, now): Promise<PreparedAction | Clarification>`. `PreparedAction = {kind: DraftRequest["kind"]; payload: Prisma.InputJsonObject; snapshot: Prisma.InputJsonObject}`. Export `ResolvedPayloadByKind`, a discriminated mapping of each kind to its normalized payload; use this mapping in resolvers/renderers/dispatch rather than unchecked JSON indexing. `Clarification = {question: string; choices: {id: string; label: string}[]; originalRequest: DraftRequest}`. `OwnerEvidence = {text: string; recentOwnerTexts: string[]; selectedIds: string[]}` comes only from stored owner turns/numbered choices, never a tool argument. No summary/draft-store import belongs in this task, keeping it independently testable before Task 10.

Use strict, transform-free tool schemas; nullable fields are explicit. At the domain boundary use the existing validators as a second validation layer. Define reusable evidence/reference schemas:

```ts
export const priceEvidenceSchema = z.object({
  quote: z.string().min(1).max(120),
  amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
const customerRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("new"), name: z.string().min(1).max(255),
    phone: z.string().nullable(), email: z.string().nullable() }).strict(),
]);
const line = z.object({
  kind: z.enum(["service", "product", "custom"]),
  id: z.string().nullable(), name: z.string().nullable(),
  quantity: z.number().int().min(1).max(999),
  priceOverride: priceEvidenceSchema.nullable(),
}).strict();
```

Declare every discriminated action member with these fields; use null for unspecified patch fields and reject empty patches:

| `kind` | Fields beyond kind; all validated before preview |
| --- | --- |
| `create_invoice` | customer: customerRef; lines: 1–30 line[]; dueDate: ISO Lagos date/null; notes: string/null |
| `create_receipt` | customer: customerRef/null; lines: 0–30 line[]; amount: priceEvidence/null; method: CASH/BANK_TRANSFER; fulfilment: PICKUP/DELIVERY/null; deliveryAddress: string/null; notes: string/null |
| `record_invoice_payment` | invoiceId; amount: priceEvidence with amountMinor > 0; method: CASH/BANK_TRANSFER; createReceipt: boolean |
| `void_invoice` | invoiceId; cancelOrder: boolean |
| `update_order` | orderId; status: READY/COMPLETED/CANCELLED |
| `adjust_stock` | optionId; mode: add/remove/set; quantity: nonnegative integer, positive for add/remove |
| `update_booking` | bookingId; status: CONFIRMED/CANCELLED/COMPLETED/null; startTime: ISO timestamp/null; at least one change, with calculated endTime and existing booked units |
| `create_product` | name; description string/null; price: priceEvidence; tracksStock boolean; options: 1–20 `{name, price: priceEvidence/null, stock: integer/null}` |
| `update_product` | productId; name string/null; description string/null; price: priceEvidence/null; isActive boolean/null; tracksStock boolean/null; options: the same option shape with existing optionId/null, or null to retain options |
| `create_service` | name; description string/null; price: priceEvidence; duration positive integer; bookingMode SLOT/NIGHTLY/DAILY; availableFrom/availableTo HH:mm; checkInTime/checkOutTime HH:mm/null; minUnits/maxUnits integers |
| `update_service` | serviceId; name/description/price/isActive/duration nullable; bookingMode SLOT/NIGHTLY/DAILY/null; availableFrom/availableTo HH:mm/null; checkInTime/checkOutTime HH:mm/null; minUnits/maxUnits integer/null; explicit fields array |
| `create_customer` | name; phone/email/address/notes nullable strings, with current normalization and length limits |
| `update_customer` | customerId; name/phone/email/address/notes nullable; `fields: string[]` enumerating explicitly changed customer fields, so null can mean clearing rather than omission |

For product/service patches, use explicit `fields` arrays too when a nullable field can be cleared. Validate field names against that action's allowed keys; fields such as name/price cannot be cleared to null. Only existing options on the owned product may be edited; unknown option IDs fail. Tracked products require a nonnegative stock integer for every new option; null stock is allowed only for an untracked product and maps to unused internal zero. `create_product` has no photo or businessId field. A line with kind custom requires name, null id and explicit price evidence; service/product lines require owned id. A receipt has either lines or an amount, never both. A product sale requires fulfilment; ask rather than assuming a payment method, delivery address or product option.

- [ ] **Step 1: Add schema, money and no-write preview tests.** Use catalog fixtures with two Tolu customers and two wig options.

```ts
it("requires a real owner quote for a price override", () => {
  expect(() => verifyOwnerPrice({ quote: "forty-five thousand", amountMinor: 4_500_000 }, {
    text: "Invoice Tolu for two wigs", recentOwnerTexts: [], selectedIds: [],
  })).toThrow("price");
});
it("parses spoken Nigerian amounts deterministically", () => {
  expect(parseEnglishAmount("forty-five thousand")).toBe(4_500_000);
  expect(parseEnglishAmount("45k")).toBe(4_500_000);
  expect(parseEnglishAmount("45,000.50")).toBe(4_500_050);
});
```

Also assert catalog price wins without a verified override, duplicate options aggregate, ambiguous matches return 2–3 labelled choices, forged IDs/business fields fail, and no invoice/receipt/customer/product `.create` or `.update` is called during resolution.
- [ ] **Step 2: Run `yarn test src/backend/services/assistant/actions/resolve.test.ts src/backend/services/assistant/actions/amount.test.ts`.** Expect missing schemas/resolvers.
- [ ] **Step 3: Implement resolution with code-computed money and guarded entity selection.** Store minor-unit integer amounts and immutable names/contacts/option IDs/quantities/prices/totals/dates/fulfilment. Include relevant current row `updatedAt`, status, available stock, catalog price provenance, the validated original `DraftRequest` and references to the trusted evidence turns in the snapshot. This supplies approval-time revalidation without inventing a request from model prose. Read prices as `option.price ?? product.price`; services use their price. Apply `Prisma.Decimal` conversion at the domain-service boundary, with currency from the business. Product input uses the existing name `tracksStock` and maximum 20 options.

```ts
export function verifyOwnerPrice(value: {quote: string; amountMinor: number}, evidence: OwnerEvidence) {
  const quote = value.quote.trim().toLowerCase();
  const found = [evidence.text, ...evidence.recentOwnerTexts]
    .some((text) => text.toLowerCase().includes(quote));
  if (!found || parseEnglishAmount(quote) !== value.amountMinor) {
    throw new Error("Please state the price you want to use.");
  }
  return value.amountMinor;
}
```

`parseEnglishAmount(text): number | null` accepts the existing digit/NGN/naira/k notation and English zero–nineteen/tens, hundred/thousand/million with optional “and”, hyphens and decimal digits; rejects unrecognized tokens, negative/nonfinite/unsafe amounts and more than two decimal places. Test “one hundred and twenty-five thousand”, “two million”, invalid words, zero and fractional currency. Do not use loose `parseFloat` on a sentence.

For multiple matching entities, a valid owned ID alone is insufficient: require a recorded owner selection in `selectedIds`, or a uniquely matching explicit full name/option in owner text. Store candidate IDs server-side for the numbered response. Never let the model choose a customer simply because its ID is valid. Resolve relative dates using the current Lagos business date; “Friday” means the next Friday including today, shown as an exact date in the summary. Search before new customer/item creation, and return a clarification if an existing match is found.
- [ ] **Step 4: Run these tests plus shared line/product/customer validators**, then typecheck/lint. Verify stock reads are informational for invoice drafts and mandatory for new product sale drafts.
- [ ] **Step 5: Commit** with `feat(assistant): validate actions and freeze catalog snapshots`.

## Task 10: Render exact approval summaries and manage draft lifecycle

**Files:** Create `src/backend/services/assistant/actions/summary.ts`, `summary.test.ts`, `drafts.ts`, `drafts.test.ts`.

**Interfaces:** Produce `renderSummary(kind, payload, snapshot): string`; `createDraft(scope, prepared, memoryVersion, now): Promise<DraftDto>`; `getPendingDraft(scope, now): Promise<DraftDto | null>`; `changeDraft(scope, actionId): Promise<DraftDto>`; `cancelDraft(scope, actionId?): Promise<void>`. These functions perform scope checks and never call a domain mutation. A changed draft stays pending for context but is marked editing; approvals of an editing action are refused until a replacement preview is shown.

- [ ] **Step 1: Add exact-summary and replacement tests.** Assert whole strings for money/dates/side effects, rather than only snapshots of arbitrary objects.

```ts
it("shows the exact two-line sale and its consequences", () => {
  expect(renderSummary("create_receipt", {
    customerName: "Amaka", currency: "NGN", method: "CASH", fulfilment: "PICKUP",
    lines: [{ name: "Shea butter", quantity: 3, unitPriceMinor: 500000, totalMinor: 1500000 }],
    totalMinor: 1500000, customerWillBeCreated: false,
  }, { stockBefore: 10, stockAfter: 7 })).toBe(
    "Record a sale for Amaka?\n3 × Shea butter · NGN 5,000 each\nTotal: NGN 15,000\nPaid cash · Pickup\nCreate a receipt and order. Stock: 10 → 7.",
  );
});
```

Use a validated payload type/fixture from `resolve.ts` in the actual test, including any required metadata. Add exact summaries for each of the 13 action kinds, explicit price override labels, newly created customer/contact fields, invoice payment plus optional receipt, order cancellation/restock, booking email/calendar consequences, and customer-field clearing.
- [ ] **Step 2: Run `yarn test src/backend/services/assistant/actions/summary.test.ts src/backend/services/assistant/actions/drafts.test.ts`.** Expect absent render/lifecycle functions.
- [ ] **Step 3: Implement deterministic summaries and one-pending replacement.** In one short transaction, verify conversation scope/version, mark existing PENDING actions REPLACED and insert the new action with expiry `new Date(now.getTime() + 24 * 60 * 60 * 1000)`. Clear editing/clarification state only when the replacement is stored successfully.

```ts
const summary = renderSummary(prepared.kind, prepared.payload, prepared.snapshot);
await tx.assistantAction.updateMany({
  where: { conversationId: conversation.id, status: "PENDING" },
  data: { status: "REPLACED" },
});
const draft = await tx.assistantAction.create({ data: {
  conversationId: conversation.id, businessId: scope.businessId,
  kind: prepared.kind, payload: prepared.payload, snapshot: prepared.snapshot,
  summary, status: "PENDING", expiresAt,
} });
```

Model text is never the approved summary. The payload/summary cannot be patched in place: edits resolve and create a new action ID. Include payment method, due date, delivery fee/address, stock effect, contact writes and known customer-email/calendar effects; no arbitrary tool-supplied URLs. Keep a WhatsApp summary plus transcript within the platform message limit; bound notes/item counts during validation and ask to split an oversized request rather than silently dropping approved content.
- [ ] **Step 4: Run both tests**, including 24-hour boundary, replaced/foreign IDs, editing-state approval refusal and failed replacement preserving the prior draft, then typecheck/lint.
- [ ] **Step 5: Commit** with `feat(assistant): add immutable approval previews`.

## Task 11: Execute approved actions atomically and return saved results on retries

**Files:** Create `src/backend/services/assistant/actions/execute.ts`, `execute.test.ts`, `approve.ts`, `approve.test.ts`; extend transaction-aware service tests where the action dispatcher adds coverage.

**Interfaces:** Produce `executeAction(tx, scope, prepared, now): Promise<{result: ActionResult; effects: Effect[]}>`; `revalidateAction(tx, scope, action, now): Promise<PreparedAction | {changed: true; explanation: string}>`; `approveAction(scope, actionId, now): Promise<ApprovalReply>`; `finalizeEffects(effects: Effect[]): Promise<void>`. Revalidation parses the stored original request/evidence references, calls Task 9's resolver and compares the values rendered by Task 10. The model registry never exports these functions. Execution dispatches each schema kind to its shared domain core, then uses `publicLink`, `productLink` or `serviceLink` for public URLs.

- [ ] **Step 1: Add approval race and failure tests** with an injected serializable transaction runner. Use the real PostgreSQL test in Task 20 as the final concurrency proof; mocks alone are insufficient.

```ts
it("returns a stored success without executing again", async () => {
  vi.mocked(db.assistantAction.findFirst).mockResolvedValue({
    id: "a1", status: "APPROVED", result: {
      text: "INV-1042 created", resourceId: "inv1", link: "https://sara.test/invoices/p1",
      affected: ["invoices", "dashboard"],
    },
  } as never);
  const reply = await approveAction(
    { businessId: "biz_1", channel: "WHATSAPP", principalId: "identity1" }, "a1", new Date(),
  );
  expect(reply.status).toBe("already_done");
  expect(invoiceService.createInTransaction).not.toHaveBeenCalled();
});
```

Add stale price/stock/invoice status, cancellation, wrong principal/channel, expiry, action failure rollback and post-commit PDF/email failure. Buttons with replaced IDs cannot approve the newest draft.
- [ ] **Step 2: Run `yarn test src/backend/services/assistant/actions/approve.test.ts src/backend/services/assistant/actions/execute.test.ts`.** Expect missing approval functions.
- [ ] **Step 3: Implement the approval transaction.** Check runtime off/unavailable state first. Within `withSerializable`, load action through the scoped conversation, verify expiry/editing/status, conditionally claim PENDING, re-resolve its frozen request against current data, compare canonical material values, execute, and persist result before commit.

```ts
const claimed = await tx.assistantAction.updateMany({
  where: { id: action.id, status: "PENDING", expiresAt: { gt: now } },
  data: { status: "APPROVED", approvedAt: now },
});
if (claimed.count !== 1) throw new Error("ACTION_CLAIM_LOST");
// Revalidation and execution remain INSIDE this transaction.
const executed = await executeAction(tx, scope, revalidated, now);
await tx.assistantAction.update({
  where: { id: action.id }, data: { result: executed.result },
});
return executed;
```

Define `const revalidated = await revalidateAction(tx, scope, action, now)` before the execute call. On a `{changed: true}` return, update the action to INVALID and return the typed changed reply from the transaction without executing; do not throw away that status update. Offer a new pending preview only after it has been independently resolved/rendered; it requires another approval. Compare current price/status/customer details/fulfilment and sufficient stock, not unrelated timestamps alone. If the summary explicitly shows stock-before/after values, those displayed values are material too. A stale action must never execute at a new price.

Dispatch all 13 kinds: invoice/receipt create, additional invoice payment, void, order status, stock mode conversion, booking status/reschedule, product/service create/update and explicit customer create/update. For a product receipt call `requireAvailableStock` and the receipt core within the approval transaction. A new customer included in a document is created inside that same transaction. Use `affected` to include dependent orders, stock/products, receipts and dashboard. No remote call belongs inside the transaction.

After commit, finalize PDFs and existing email/calendar effects with per-effect catches and safe identifiers in logs. Follow current best-effort delivery semantics: failure cannot turn a committed write into a retryable mutation or hide its saved result. Replayed approval returns saved success and does not replay effects. A timeout after commit returns/retrieves the saved result instead of “nothing happened.” Approval itself never calls OpenAI. Call `recordApprovalUsage` after the transaction outcome, and make logging failure unable to obscure a committed result.
- [ ] **Step 4: Run all action and affected domain tests**, then typecheck/lint. Require zero writes on expired/replaced/foreign/changed drafts and one mutation for two approvals with different inbound message IDs.
- [ ] **Step 5: Commit** with `feat(assistant): execute approved actions exactly once`.

## Task 12: Build the curated registry, prompt and bounded assistant turn

**Files:** Create `src/backend/services/assistant/tools/registry.ts`, `registry.test.ts`, `prompt.ts`, `loop.ts`, `loop.test.ts`, `index.ts`, `index.test.ts`.

**Interfaces:** Produce `buildTools(): FunctionTool[]`, `dispatchTool(context, name, argumentsJson): Promise<ToolOutcome>`, `runModelTurn(input): Promise<{reply: string; draft: DraftDto | null; toolRecords: StoredTurn["toolRecords"]}>`, and `assistantService.message(input): Promise<AssistantReply>`. Define:

```ts
export type ToolOutcome =
  | { kind: "read"; data: Prisma.JsonValue; text: string }
  | { kind: "draft"; draft: DraftDto }
  | { kind: "clarification"; question: string; choices: {id: string; label: string}[] }
  | { kind: "error"; code: string; message: string };
export type ToolContext = {
  scope: AssistantScope; conversationId: string; memoryVersion: number;
  evidence: OwnerEvidence; now: Date; signal: AbortSignal;
};
export type AssistantMessageInput = {
  scope: AssistantScope; requestId: string;
  input: { kind: "text"; text: string }
    | { kind: "audio"; load: (signal: AbortSignal) => Promise<{bytes: Uint8Array; mime: string}> };
  onProgress?: () => Promise<void> | void;
};
```

`input.load` is server-owned, used after guards/quota. Web/channels cannot pass arbitrary URLs to the model. Publish the nine read tool names from Task 4 and one `draft_<kind>` tool per action kind from Task 9. Each registry entry contains `access: "read" | "draft"`, its Zod schema and its exact handler; no `approve`, `execute`, raw SQL, general HTTP, settings or customer-messaging tool.

- [ ] **Step 1: Add a scripted fake Responses transport test**, with protocol-shaped output rather than live model calls.

```ts
it("returns unknown-tool errors without calling a service", async () => {
  const outcome = await dispatchTool({
    scope: { businessId: "biz_1", channel: "WHATSAPP", principalId: "i1" },
    conversationId: "c1", memoryVersion: 0,
    evidence: { text: "hello", recentOwnerTexts: [], selectedIds: [] },
    now: new Date(), signal: new AbortController().signal,
  }, "execute_sql", '{"query":"delete from invoice"}');
  expect(outcome).toMatchObject({ kind: "error", code: "UNKNOWN_TOOL" });
});
```

Add a two-response read loop; a draft tool that never calls a mutation; malformed JSON/Zod errors returned to model; 6-round termination; progress at 4 seconds and timer cleanup; abort at 25 seconds; all response usages accumulated; unavailable/quota/duplicate requests making zero SDK calls.
- [ ] **Step 2: Run `yarn test src/backend/services/assistant/tools/registry.test.ts src/backend/services/assistant/loop.test.ts src/backend/services/assistant/index.test.ts`.** Expect missing registry/orchestrator.
- [ ] **Step 3: Implement schemas, prompt and orchestration.** Build strict JSON schemas from each transform-free object variant with `z.toJSONSchema`, stripping only unsupported root metadata; never publish the whole discriminated union as a root function schema. All properties are required and optional values are nullable, with `additionalProperties: false`. Add a schema compatibility test for every tool.

```ts
const response = await getOpenAI().responses.create({
  model: assistantConfig().model,
  instructions: SYSTEM_PROMPT,
  tools: buildTools(),
  input: protocolItems,
  reasoning: { effort: "low" },
  parallel_tool_calls: false,
  max_output_tokens: MAX_OUTPUT_TOKENS,
  store: false,
}, { signal });
usage.addResponseUsage(response.usage);
protocolItems.push(...response.output);
for (const item of response.output) {
  if (item.type !== "function_call") continue;
  const outcome = await dispatchTool(context, item.name, item.arguments);
  protocolItems.push({ type: "function_call_output", call_id: item.call_id,
    output: JSON.stringify(outcome) });
}
```

Use the installed SDK's exact `ResponseInput`/`ResponseOutputItem` types; do not suppress protocol type errors with `any`. Preserve all current-round output items in order, including reasoning items needed for tool continuation; persist only concise completed tool records. Static prompt/tools precede dynamic business context (name, currency, `sells`, Lagos date). Historical owner text, catalog descriptions, transcripts and tool outputs are data, never system instructions.

Prompt rules, written literally into `SYSTEM_PROMPT`: use lookups before IDs/numbers; ask numbered choices for ambiguity; search before new customer/item; catalog prices unless explicit owner evidence; writes are previews only; no invented success; short WhatsApp formatting with `*bold*` and numbered lists; no tables/headings; unsupported requests mention `menu`; no settings tools, non-English promises or customer WhatsApp sends. Include examples of malicious instructions embedded in item descriptions being ignored.

The service acquires scope/lease, checks availability, reserves usage, starts one abort deadline and one progress timer, loads/transcribes audio if necessary, loads bounded recent history, then runs the model. Persist transcript before interpreting, even if the model subsequently fails. Always clear timers, release lease and finalize usage in `finally`. Progress failures do not abort the request. The deadline signal is checked before every read/draft operation; a late response cannot publish a draft.

When a draft tool succeeds, stop the loop and return its canonical summary. When a clarification is required, persist its server-side candidates and return the numbered question; do not let another tool bypass it in the same turn. For reports, render the returned tool facts directly; the model selects the relevant read, not arbitrary monetary prose. A greeting or no-tool answer uses “I can help with invoices, sales, bookings and your numbers. Reply menu for the numbered menu.” A request for a factual report with no supporting tool gets a lookup/clarification response, never an invented amount. On tool/domain validation failure, return a safe error to the model within the remaining budget, so it can ask a focused follow-up.

At most one change is previewed per turn. For multi-action requests ask which action to do first. A successful read cannot claim a mutation occurred. An editing turn gets the old immutable draft plus owner correction in context and creates a replacement action only on successful resolution.
- [ ] **Step 4: Run all assistant tests and existing messaging tests**, then typecheck/lint. Test independent WEB/WhatsApp history, 30-minute expiry, reset races, prompt injection, hallucinated “created” text after a draft, selected-customer choices and token usage on timeout. No live calls in ordinary CI.
- [ ] **Step 5: Commit** with `feat(assistant): add bounded tool-calling conversations`.

## Task 13: Download and transcribe bounded, transient audio

**Files:** Create `src/backend/services/messaging/channels/whatsapp/media.ts`, `media.test.ts`, `src/backend/services/assistant/audio.ts`, `audio.test.ts`.

**Interfaces:** Produce `downloadWhatsAppAudio(mediaId, signal): Promise<{bytes: Uint8Array; mime: string}>`, `readBoundedBody(response, maxBytes, signal): Promise<Uint8Array>`, `transcribeAudio(audio, signal): Promise<{text: string; seconds: number}>`, and `transcriptPrefix(text): string`. Define errors `AUDIO_TOO_LONG`, `AUDIO_TOO_LARGE`, `AUDIO_UNREADABLE` with safe user messages; no media bytes/tokens/URLs in exceptions.

- [ ] **Step 1: Add mocked fetch and transcription tests.** Mock `music-metadata` and `getOpenAI`; include streamed bytes with no `Content-Length`.

```ts
it("stops reading a stream at the byte cap", async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(5));
      controller.enqueue(new Uint8Array(6));
      controller.close();
    },
  }));
  await expect(readBoundedBody(response, 10, new AbortController().signal))
    .rejects.toThrow("AUDIO_TOO_LARGE");
});
it("caps the transcript prefix without changing the stored transcript", () => {
  const text = "a".repeat(250);
  expect(transcriptPrefix(text)).toBe(`🎙️ "${"a".repeat(199)}…"\n\n`);
  expect(text.length).toBe(250);
});
```

Also test metadata HTTP errors, download HTTP errors, off/unlinked requests making no download, wrong MIME, corrupt bytes, abort, 120/121 seconds, unknown container duration, empty/no-speech transcription and English language parameter.
- [ ] **Step 2: Run `yarn test src/backend/services/messaging/channels/whatsapp/media.test.ts src/backend/services/assistant/audio.test.ts`.** Expect missing helpers.
- [ ] **Step 3: Implement authenticated fetch and Whisper transcription.** Reuse the WhatsApp adapter's Graph base/version. Fetch `/<mediaId>` with `Authorization: Bearer <WHATSAPP_TOKEN>`, then the returned media URL with the same token. Require HTTPS, no credentials/nondefault port and hostname `lookaside.fbsbx.com`, a subdomain of `fbsbx.com`, or a subdomain of `fbcdn.net`; use `redirect: "error"` on the authenticated media request. Never accept owner/model-provided URLs.

Check advertised file size and stream bytes against 10 MiB. Permit normalized `audio/ogg`, `audio/webm`, `audio/mp4`, `audio/m4a`, `audio/x-m4a` with codec parameters stripped; sniff/parse the container rather than trusting the label. MP4 is named `.mp4`, Ogg `.ogg`, WebM `.webm`. Browser `video/webm` is accepted only when metadata confirms an audio-only stream. Do not accept arbitrary videos.

```ts
const metadata = await parseBuffer(audio.bytes, { mimeType: audio.mime }, { duration: true });
const knownDuration = metadata.format.duration;
if (knownDuration !== undefined && (!Number.isFinite(knownDuration) || knownDuration <= 0)) {
  throw new Error("AUDIO_UNREADABLE");
}
if (knownDuration !== undefined && knownDuration > MAX_AUDIO_SECONDS) {
  throw new Error("AUDIO_TOO_LONG");
}
const result = await getOpenAI().audio.transcriptions.create({
  file: await toFile(audio.bytes, filename, { type: audio.mime }),
  model: assistantConfig().transcribeModel,
  language: "en", response_format: "verbose_json",
}, { signal });
if (!Number.isFinite(result.duration) || result.duration <= 0) throw new Error("AUDIO_UNREADABLE");
if (result.duration > MAX_AUDIO_SECONDS) throw new Error("AUDIO_TOO_LONG");
```

`filename` is selected by the normalized MIME mapping above. If the parser cannot obtain duration from a valid container, the cap plus final Whisper check applies; record billed seconds even if final length validation rejects. Keep buffers in request memory only and release references after transcription; never write audio to disk, Cloudinary, DB, history or debug logs. Prefix read answers, draft replies and later model-error replies once when successful transcription already produced text. Failure says “Sorry, I couldn't make that out. Could you try again, or type it?”; length says “Please send a voice note of 2 minutes or less, or type your request.”
- [ ] **Step 4: Run both test files and assistant orchestrator tests**, then typecheck/lint. Use tiny synthetic or consented nonpersonal audio fixtures for actual parser tests; include Ogg/Opus, WebM/Opus and iOS MP4 before release.
- [ ] **Step 5: Commit** with `feat(assistant): transcribe bounded voice notes`.

## Task 14: Carry audio and approval buttons through channel adapters

**Files:** Modify `src/backend/services/messaging/channels/types.ts`, `channels/whatsapp/index.ts`, `index.test.ts`, `channels/instagram/index.ts`, `index.test.ts`, and inbound-message test factories in engine/session tests; create `src/backend/services/messaging/assistant.ts`, `assistant.test.ts`.

**Interfaces:** Replace the inbound shape with a discriminated union; preserve channel/externalId/messageId/displayName common fields. Add optional outbound buttons. Produce `presentAssistantReply(channel, reply: AssistantReply | ApprovalReply): OutboundMessage` and `parseAssistantButton(id): {action: "send" | "change"; actionId: string} | null`.

```ts
type InboundBase = {
  channel: ChatChannel; externalId: string; messageId: string; displayName?: string;
};
export type InboundMessage = InboundBase & (
  | { kind: "text"; text: string }
  | { kind: "voice"; mediaId: string; mime: string | null }
  | { kind: "button"; buttonId: string }
);
export type OutboundMessage = {
  text: string; buttons?: {id: string; title: string}[];
};
```

- [ ] **Step 1: Extend adapter tests with real webhook-shaped payloads.** Assert the parser carries media/button IDs without treating button display text as an owner sentence.

```ts
expect(whatsAppAdapter.normalizeInbound({ entry: [{ changes: [{ value: {
  messages: [{ from: "234800", id: "m1", type: "audio",
    audio: { id: "media1", mime_type: "audio/ogg; codecs=opus" } }],
} }] }] })).toEqual([
  { channel: "WHATSAPP", externalId: "234800", messageId: "m1",
    kind: "voice", mediaId: "media1", mime: "audio/ogg; codecs=opus" },
]);
```

Keep existing contact/displayName expectations where supplied. Add interactive `button_reply`, malformed IDs, images/stickers/status notifications ignored, Instagram echo/audio ignored and unchanged text link previews.
- [ ] **Step 2: Run `yarn test src/backend/services/messaging/channels src/backend/services/messaging/assistant.test.ts`.** Expect new normalization/presentation assertions to fail.
- [ ] **Step 3: Implement parsers and outbound presentation.** WhatsApp draft button IDs are `assistant:send:<actionId>` and `assistant:change:<actionId>`; parse only these exact forms, with length bounds. The scope is checked on lookup, never encoded as authorization in the ID.

```ts
const buttons = [
  { id: `assistant:send:${draft.id}`, title: "Send it" },
  { id: `assistant:change:${draft.id}`, title: "Change something" },
];
const payload = {
  messaging_product: "whatsapp", to: externalId, type: "interactive",
  interactive: { type: "button", body: { text: message.text },
    action: { buttons: buttons.map(({ id, title }) => ({
      type: "reply", reply: { id, title },
    })) } },
};
```

Validate up to three buttons and 20-character titles. Keep regular text sends and link-card priming unchanged. For an interactive body over 1,024 characters, send the exact summary as a regular text message first, then a short interactive message “Use the summary above.” with the same draft buttons; do not send buttons when the summary delivery fails. Bound the overall text reply to WhatsApp's 4,096-character message capacity during preview construction. No truncation of financial or action details.

Instagram gets the same summary plus `Reply yes to send, or change something to edit.` without buttons. WhatsApp also accepts exact typed confirmations. Present stored action results directly, including “Already done” and their existing link; never claim successful execution from model output.
- [ ] **Step 4: Run adapter/presenter tests and all existing messaging tests**, fixing typed fixtures to use `kind: "text"`; run typecheck/lint. Assert one transcript prefix and byte-for-byte same canonical summary across channels.
- [ ] **Step 5: Commit** with `feat(messaging): support voice events and draft buttons`.

## Task 15: Route assistant requests without breaking the numbered menu

**Files:** Modify `src/backend/services/messaging/engine/index.ts`, `index.test.ts`; extend `messaging/assistant.ts` and tests; add assistant cancellation/reset tests in `assistant/store.test.ts`.

**Interfaces:** Keep `conversationEngine.handle(message, options?): Promise<OutboundMessage | null>` and `HandleOptions.onProgress`. Add `routeAssistantMessage(scope, message, options): Promise<OutboundMessage>` to the messaging bridge; it calls `assistantService.message`, `approveAction`, `changeDraft` or `cancelDraft` without exposing domain writes to the model.

- [ ] **Step 1: Write table-driven routing tests.** Preserve complete existing invoice/receipt/menu regression tests; change only main-menu unknown-text expectations when the assistant is available.

```ts
it("keeps a typed menu amount in its existing flow", async () => {
  mockedSession.getOrCreateSession.mockResolvedValue({
    ...IDENTITY.session, state: "INVOICE_AMOUNT", context: { customerName: "Tolu" },
  });
  await conversationEngine.handle(inbound("45000"));
  expect(assistantService.message).not.toHaveBeenCalled();
});
it("never approves from a transcript saying yes", async () => {
  await conversationEngine.handle({ channel: "WHATSAPP", externalId: "234800",
    messageId: "voice1", kind: "voice", mediaId: "media1", mime: "audio/ogg" });
  expect(approveAction).not.toHaveBeenCalled();
});
```

`INVOICE_AMOUNT` is the engine's existing amount-state string; its context stores `customerName`, so use `{customerName: "Tolu"}` in the fixture. Add linked/unlinked voice, exact typed yes/send it, no pending draft, change then typed correction, cancel, menu/0, clarification digit, main-menu digit, active menu flow, off switch and exhausted quota.
- [ ] **Step 2: Run `yarn test src/backend/services/messaging/engine/index.test.ts src/backend/services/messaging/assistant.test.ts`.** Expect routing failures.
- [ ] **Step 3: Implement this explicit precedence after identity lookup and durable claim.** Keep linking ahead of audio download/OpenAI, and keep 24-hour menu staleness independent of assistant history.

```ts
const typed = message.kind === "text" ? message.text.trim().toLowerCase() : null;
const button = message.kind === "button" ? parseAssistantButton(message.buttonId) : null;
if (button) return routeAssistantMessage(scope, message, options);
if (typed && ["menu", "0", "cancel"].includes(typed)) {
  await resetMemory(scope);
  if (typed === "cancel") await cancelDraft(scope);
  // Save MAIN_MENU using the existing engine branch, then return its menu.
}
```

For the remainder: exact typed `yes`/`send it` with a nonediting pending draft approves it; exact `change something` marks editing and asks “What should change?”; an active assistant clarification number resolves a stored choice before menu-number handling; an active assistant edit routes its next message to the assistant. Then preserve valid main-menu digits and typed menu-flow replies. Voice resets the menu state/context to MAIN_MENU and goes to the assistant; every other main-menu sentence goes to the assistant. Unsupported button IDs are ignored with no paid call.

Menu/0 resets memory and editing/clarification, but does not silently approve or execute a draft. Cancel invalidates it. An unavailable/off assistant returns “I can't take voice notes right now — reply menu” for voice and the existing menu for free text; assistant draft controls receive an unavailable response rather than falling into a legacy menu confirmation. The daily cap points owners to `menu`, while an already-visible valid draft can still be approved without a model call.

The bridge's onProgress wrapper sends one “One moment…” after 4 seconds through the existing hook. Existing menu creation progress stays as it is. Rejected progress sends cannot break the turn. Use `messageId` as the chat requestId and the linked identity's ID as principalId.
- [ ] **Step 4: Run all messaging and assistant tests**, then typecheck/lint. Cover “1” after an assistant customer-choice question, voice interrupting an invoice flow, stale button after replacement, interleaved duplicate IDs and typed nonexact “yes but make it three” going to editing rather than approval.
- [ ] **Step 5: Commit** with `feat(messaging): route plain-English assistant requests`.

## Task 16: Acknowledge Meta webhooks before background processing

**Files:** Create `src/backend/services/messaging/process.ts`, `process.test.ts`, `src/app/api/webhooks/instagram/route.test.ts`; modify both Meta webhook `route.ts` files and `src/app/api/webhooks/whatsapp/route.test.ts`.

**Interfaces:** Produce `processInboundBatch(adapter: ChannelAdapter, messages: InboundMessage[]): Promise<void>`. Group messages by channel/externalId, process each group sequentially, and allow independent groups concurrently. Keep both routes `runtime = "nodejs"`; export `maxDuration = 60` where the deployment supports it.

- [ ] **Step 1: Add deferred-response tests with a mocked `after` queue.** Use existing signature fixtures, keeping auth and parse checks synchronous.

```ts
const callbacks = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", async (original) => ({
  ...await original<typeof import("next/server")>(),
  after: vi.fn((callback: () => Promise<void>) => callbacks.push(callback)),
}));
it("acknowledges without waiting for engine work", async () => {
  const response = await POST(signedRequest);
  expect(response.status).toBe(200);
  expect(conversationEngine.handle).not.toHaveBeenCalled();
  await callbacks.shift()!();
  expect(conversationEngine.handle).toHaveBeenCalled();
});
```

`signedRequest` is the existing route-test request built from the known signature fixture; define it in the test before POST. Reset callback arrays between tests. Assert invalid signatures schedule nothing, malformed payloads are handled, and two same-sender messages retain input order.
- [ ] **Step 2: Run `yarn test src/app/api/webhooks/whatsapp/route.test.ts src/app/api/webhooks/instagram/route.test.ts src/backend/services/messaging/process.test.ts`.** Expect synchronous engine processing to fail timing assertions.
- [ ] **Step 3: Move processing into `after()`.** Parse and normalize the verified raw body before scheduling; capture messages/adapter, not the request. Await the whole processing promise inside the callback.

```ts
const messages = adapter.normalizeInbound(JSON.parse(rawBody));
after(async () => {
  await processInboundBatch(adapter, messages);
});
return NextResponse.json({ status: "ok" }, { status: 200 });
```

`processInboundBatch` catches per-message errors, sends progress/final replies through the adapter and checks `SendResult`. One failing message cannot suppress other owners' replies. Do not detach unawaited promises inside the callback. Remove raw request/transcript/reply bodies from WhatsApp debug logs; preserve safe event type, message ID, timings and success/error codes. Do not expose media URLs/tokens in logs.

Cross-webhook assistant concurrency is controlled by the conversation lease; this batch ordering does not pretend to be a durable queue. `after()` follows the chosen spec's best-effort hosting lifecycle: test it on the actual deployment and configure enough execution time for the 25-second deadline plus delivery. A durable job queue is a separate future change, not silently introduced here.
- [ ] **Step 4: Run the three test files plus full messaging tests**, then typecheck/lint. Verify Instagram typed assistant replies, text confirmations, no synthetic buttons/audio, progress delivery and signature regressions.
- [ ] **Step 5: Commit** with `feat(webhooks): process assistant replies after acknowledgement`.

## Task 17: Add authenticated, bounded web assistant endpoints

**Files:** Create `src/backend/services/assistant/http.ts`, `http.test.ts`, `src/backend/validators/assistant.validator.ts`, `src/app/api/assistant/messages/route.ts`, `route.test.ts`, `src/app/api/assistant/drafts/[id]/approve/route.ts`, `route.test.ts`, and the equivalent `change/route.ts`, `route.test.ts`.

**Interfaces:** Produce `requireAssistantOwner(request: NextRequest): Promise<AssistantScope>` and `readAssistantInput(request, signal): Promise<{requestId: string; conversationId: string | null; input: AssistantMessageInput["input"]}>`. All three routes use node runtime. Their successful data is wrapped in existing `ApiResponse<T>`:

| Endpoint | Input | Output |
| --- | --- | --- |
| `POST /api/assistant/messages` | JSON `{requestId: UUID, conversationId?: string, text: string}` or multipart with requestId, optional conversationId and one audio File; text/audio mutually exclusive | `AssistantReply` |
| `POST /api/assistant/drafts/:id/approve` | JSON `{conversationId: string}` | `ApprovalReply` |
| `POST /api/assistant/drafts/:id/change` | JSON `{conversationId: string}` | `{conversationId: string; reply: "What should change?"; draft: DraftDto}` |

`requireAssistantOwner` uses `authService.sessionFromRequest`; scope is WEB with the session user's business and user ID. Missing session →401, no business/non-owner →403, foreign conversation/draft →404. Structural input errors →422, too-large body →413, unsupported media →415, busy conversation →409; ordinary answered/error assistant replies use their typed data envelope.

- [ ] **Step 1: Add route authentication, exclusivity and scope tests.** Follow current products route session helpers and use actual `NextRequest` for streaming-body tests.

```ts
it("rejects an unlinked channel draft from the web", async () => {
  mockAuthenticatedSession(mockedDb, { user: { id: "owner1" },
    business: { id: "biz_1", ownerId: "owner1" } });
  mockedDb.assistantAction.findFirst.mockResolvedValue(null);
  const request = createMockRequest({ method: "POST", cookies: authenticatedCookies(),
    body: { conversationId: "web1" } });
  const response = await APPROVE(request, { params: Promise.resolve({ id: "wa1" }) });
  expect(response.status).toBe(404);
  expect(invoiceService.createInTransaction).not.toHaveBeenCalled();
});
```

Adapt route-context parameter typing to Next 15 async params; export imported route `POST` as `APPROVE` in this test. Add no-session-before-body-read, explicit businessId rejection, foreign user, duplicate requestId cached reply, expired approval and edit-without-mutation cases.
- [ ] **Step 2: Run `yarn test src/backend/services/assistant/http.test.ts src/app/api/assistant/`.** Expect missing handlers/helper.
- [ ] **Step 3: Implement a thin assistant-specific authenticated wrapper.** The generic `withMiddleware` currently parses before auth and logs parsed message bodies. Leave unrelated middleware behavior alone; reuse its exception-to-envelope conventions in `http.ts`, but authenticate and check ownership **before** reading input and never log body/transcript/audio.

```ts
export async function requireAssistantOwner(request: NextRequest): Promise<AssistantScope> {
  const session = await authService.sessionFromRequest(request);
  if (!session) throw new UnauthorizedException("Unauthorized");
  const business = session.user.business;
  if (!business || business.ownerId !== session.user.id) {
    throw new ForbiddenException("Business owner required");
  }
  return { businessId: business.id, principalId: session.user.id, channel: "WEB" };
}
```

Reject cross-origin cookie writes using the request origin, while retaining existing supported bearer-session behavior. Read JSON with a 16 KiB streaming cap and text length 1–4,096. Read multipart into a bounded buffer (10 MiB plus 64 KiB framing), then parse that bounded body; require a single nonempty audio file. Reject multiple audio fields, mixed text/audio and unknown fields. Do not rely on `Content-Length` alone or parse an unbounded FormData first. Feed audio via the server-created lazy loader after availability/quota guards; the owner-reported duration is never authoritative.

Check a supplied conversationId against WEB scope; if absent, get/create that scope's conversation. Calls to approve/change first verify both route action ID and supplied conversation. The server fetches the stored payload; no approval endpoint accepts a client replacement payload, amount, summary or businessId. Include standard API JSDoc descriptions/content type/auth, without generating the model's tool catalog from them.
- [ ] **Step 4: Run all assistant route/helper tests**, then typecheck/lint. Assert unauthenticated uploads are rejected without reading the file, streamed oversize bodies stop, private inputs are not logged and audio errors still permit later typed requests.
- [ ] **Step 5: Commit** with `feat(assistant): expose owner-scoped web endpoints`.

## Task 18: Implement a cancellable browser hold-to-talk controller

**Files:** Create `src/utils/audio-recorder.ts`, `audio-recorder.test.ts`, `src/hooks/use-voice-recorder.ts`; no new browser-test library is required.

**Interfaces:** Produce `createAudioRecorder(deps): AudioRecorderController`, where `deps` supplies `getUserMedia`, the MediaRecorder constructor/static MIME check, timers and callbacks. The controller exposes `start(): Promise<void>`, `stop(): void`, `cancel(): void`, `dispose(): void`; callbacks are `onState("idle" | "requesting" | "recording" | "stopping")`, `onAudio({blob: Blob; filename: string; seconds: number})`, `onError(message: string)`. `useVoiceRecorder({onAudio})` wraps this controller and exposes `start`, `stop`, `cancel`, `state`, `error`, `supported`; browser globals are accessed only after mounting/user action.

- [ ] **Step 1: Write injected-controller tests in Vitest node.** Fake MediaRecorder with `EventTarget` and Blob, and a stream with track spies.

```ts
it("releases a stream if permission resolves after release", async () => {
  let resolve!: (stream: MediaStream) => void;
  const getUserMedia = vi.fn(() => new Promise<MediaStream>((done) => { resolve = done; }));
  const stop = vi.fn();
  const onAudio = vi.fn();
  const controller = createAudioRecorder({
    getUserMedia, MediaRecorder: FakeRecorder, onAudio,
    onError: vi.fn(), onState: vi.fn(),
    setTimeout, clearTimeout, now: () => Date.now(),
  });
  const start = controller.start();
  controller.stop();
  resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await start;
  expect(stop).toHaveBeenCalledOnce();
  expect(onAudio).not.toHaveBeenCalled();
});
```

Define `FakeRecorder` in this test file with supported MIME selection, `start`, `stop`, `state`, `mimeType`, and a final `dataavailable` then `stop` event. Test permission denial, missing APIs, release outside control, cancel, 120-second stop, stop twice and recorder error/unmount cleanup.
- [ ] **Step 2: Run `yarn test src/utils/audio-recorder.test.ts`.** Expect missing controller.
- [ ] **Step 3: Implement the controller state machine and hook cleanup.** Prefer `audio/webm;codecs=opus`, then `audio/mp4`; if neither is explicitly supported, let the browser choose and use `recorder.mimeType`. Do not rename MP4 bytes to WebM.

```ts
let generation = 0;
async function start() {
  const current = ++generation;
  onState("requesting");
  const stream = await getUserMedia({ audio: true });
  if (current !== generation) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  // Construct the recorder only after this generation check.
}
function cancel() {
  generation++;
  discard = true;
  if (recorder?.state === "recording") recorder.stop();
  stream?.getTracks().forEach((track) => track.stop());
  clearTimeout(limitTimer);
  onState("idle");
}
```

Declare the referenced stream/recorder/chunks/discard/timer state within the controller. Normal `stop()` waits for the final `dataavailable` event before building the Blob and invokes `onAudio` once; cancel/dispose discard it. Every completion/error path stops every track and clears timers. A release during permission request invalidates generation. Stop/upload at 120 seconds with “Two-minute limit reached”; a zero-byte recording is discarded. The hook calls dispose on unmount and on panel closure, and surfaces “Microphone access was refused. You can still type.” without disabling text input.
- [ ] **Step 4: Run controller tests**, then typecheck/lint. Confirm all fake tracks stop and no cancelled recording invokes upload. Actual pointer/keyboard/browser checks belong to Task 19; static JSX tests do not validate MediaRecorder behavior.
- [ ] **Step 5: Commit** with `feat(assistant): add cancellable hold-to-talk recording`.

## Task 19: Add the dashboard panel and typed client methods

**Files:** Modify `src/utils/api.ts`, `src/components/app-chrome.tsx`; create `src/hooks/mutations/use-assistant-mutations.ts`, `src/components/assistant/assistant-panel.tsx`, `draft-card.tsx`, `draft-card.test.tsx`, `message-list.tsx`, `message-list.test.tsx`.

**Interfaces:** Add `api.assistant.message(input: {requestId: string; conversationId?: string; text: string} | {requestId: string; conversationId?: string; audio: Blob; filename: string}): Promise<AssistantReply>`, `approve(conversationId, actionId): Promise<ApprovalReply>`, `change(conversationId, actionId): Promise<{conversationId: string; reply: string; draft: DraftDto}>`. Produce `useAssistantMessageMutation`, `useAssistantApproveMutation`, `useAssistantChangeMutation`, all with `retry: false`. `AssistantPanel({open, onOpenChange})` owns its in-memory transcript and current conversation/draft; `DraftCard({draft, busy, editing, now, onApprove, onChange})` renders the canonical summary verbatim.

- [ ] **Step 1: Add static-render component tests using `react-dom/server`.** Follow the existing order-row component-test pattern; inject `now` to make expiry deterministic.

```tsx
it("shows the canonical draft and disables an expired approval", () => {
  const html = renderToStaticMarkup(<DraftCard
    draft={{ id: "a1", summary: "Invoice Tolu?\nTotal: NGN 90,000",
      expiresAt: "2026-11-04T10:00:00Z", status: "PENDING" }}
    busy={false} editing={false} now={new Date("2026-11-04T10:00:01Z")}
    onApprove={() => undefined} onChange={() => undefined}
  />);
  expect(html).toContain("Total: NGN 90,000");
  expect(html).toContain("Expired");
  expect(html).toContain("disabled");
});
```

Test visible transcript, empty/help state, recording-permission text fallback, pending/approved/replaced status, links from actual action results, and escaped owner text. Do not introduce `dangerouslySetInnerHTML` for model replies.
- [ ] **Step 2: Run `yarn test src/components/assistant/`.** Expect missing components.
- [ ] **Step 3: Implement API methods, mutations and UI using existing primitives.** `api.ts` uses existing axios/data helpers and credentials; create FormData for audio without forcing a multipart Content-Type boundary. Generate `crypto.randomUUID()` once per user submission and retain it for a manual network retry. Do not automatically retry approval or audio upload.

```tsx
<Modal open={open} onOpenChange={onOpenChange}>
  <Modal.Portal className="sm:items-stretch sm:justify-items-end sm:p-0">
    <Modal.Content className="flex h-[85dvh] min-h-0 flex-col gap-4 sm:h-dvh sm:max-w-[440px] sm:rounded-none">
      <Modal.Handle />
      <Modal.Title>Sara</Modal.Title>
      <Modal.Description>Ask about your business, or hold to talk.</Modal.Description>
      <Modal.Dismiss />
      <MessageList messages={messages} />
      <form onSubmit={sendText} className="grid gap-3">
        <label htmlFor="sara-message" className="text-ink text-sm font-semibold">Message Sara</label>
        <Textarea id="sara-message" value={text} onChange={(event) => setText(event.target.value)} />
        <div className="flex gap-2">
          <Button type="submit" isLoading={busy}>Send</Button>
          <Button variant="secondary" disabled={busy || !recorder.supported}
            onPointerDown={startPointerRecording} onPointerUp={stopPointerRecording}
            onPointerCancel={cancelRecording} onKeyDown={startKeyboardRecording}
            onKeyUp={stopKeyboardRecording}>Hold to talk</Button>
        </div>
      </form>
    </Modal.Content>
  </Modal.Portal>
</Modal>
```

Define the component state/handlers above using the documented mutation hooks/recorder; the snippet fixes composition and existing primitive APIs. MessageList receives `{id: string; role: "owner" | "sara"; text: string; transcript?: string}[]` and uses an inner `min-h-0 flex-1 overflow-y-auto` scroll area with `role="log"`. Use token colors and whitespace-preserving text. Keep the draft card outside free-form model text with Send it/Change something actions; only the current pending, nonediting, unexpired draft is enabled.

Pointer down captures the pointer and starts from that gesture; pointer up releases/stops, pointer cancel discards. Enter/Space keydown starts once and keyup stops; prevent default/repeat behavior. Escape/close/cancel/unmount releases the mic; closing during upload does not auto-approve or fabricate success. Use an `aria-live="polite"` status for recording, “One moment…” and errors; focus returns to the Sara trigger. Provide text correction after Change something and display the returned transcript separately from editable input.

AppChrome adds a small “Sara” button beside owner controls and mounts one panel instance outside the header's clipped/stacked content. It remains mounted across route navigation. On successful approval invalidate only `affected` query families using existing `invoiceKeys`, `receiptKeys`, `orderKeys`, `productKeys`, `serviceKeys`, `bookingKeys`, `customerKeys`, `dashboardKeys`; preview/change do not invalidate domain data. No new design tokens, unrelated navigation changes or owner usage screen.
- [ ] **Step 4: Run assistant component/recorder/route tests, typecheck and lint; manually inspect in the running app at 375px and desktop.** Validate Chrome and iOS Safari MP4, denied/unsupported mic with working text, permission-after-release, pointer leaving the control, Space/Enter, Escape/focus return, reduced motion, long transcript scrolling, duplicate taps, price-change response and identical WhatsApp/web summary. The repository has no DOM-test environment; these checks are explicitly browser acceptance, not claims of automated coverage.
- [ ] **Step 5: Commit** with `feat(assistant): add dashboard voice and text panel`.

## Task 20: Prove concurrency guarantees and add the 30-case evaluation gate

**Files:** Create `src/backend/services/assistant/approval.integration.test.ts`, `vitest.assistant-integration.config.ts`, `evals/assistant/cases.ts`, `fixtures.ts`, `src/backend/services/assistant/evaluation.ts`, `scripts/eval-assistant.ts`; add `test:assistant:integration` and `eval:assistant` scripts to `package.json`. Extend `loop.ts` to accept typed transport/tool dependencies rather than requiring real domain writes in evaluations.

**Interfaces:** Export `EvaluationCase = {id: string; turns: string[]; expected: {kind: "read" | "draft" | "clarification" | "unsupported"; tool: string | null; facts: Record<string, string | number | boolean>; forbiddenWrites: boolean}}` and `EVALUATION_CASES: EvaluationCase[]`. Produce `evaluateCases(cases, dependencies): Promise<{passed: number; failed: {id: string; reason: string}[]; estimatedCostUsd: string | null; timingsMs: number[]}>`. `ModelDependencies = {responses: Pick<OpenAI["responses"], "create">; dispatch: typeof dispatchTool}` is injected as an optional second argument of `runModelTurn`, defaulting to real transport/registry. The fake dispatcher returns read fixtures and draft previews, records normalized proposed payloads, and **has no approval/domain-mutation implementation**.

- [ ] **Step 1: Write real PostgreSQL concurrent approval tests and deterministic evaluation-assertion tests.** Integration configuration refuses any URL that is not localhost/127.0.0.1 with database name `sara_assistant_test`. Mock only remote PDF/email/calendar effects; use the actual Prisma transaction/database for claims, invoices, receipts, orders, stock and usage.

```ts
it("commits one sale when distinct messages approve concurrently", async () => {
  const replies = await Promise.all([
    approveAction(scope, draft.id, now),
    approveAction(scope, draft.id, now),
  ]);
  expect(replies.map((reply) => reply.status).sort()).toEqual(["already_done", "approved"]);
  expect(await db.receipt.count({ where: { businessId: scope.businessId } })).toBe(1);
  expect(await db.order.count({ where: { businessId: scope.businessId } })).toBe(1);
  const option = await db.productOption.findUniqueOrThrow({ where: { id: optionId } });
  expect(option.stock).toBe(7);
});
```

Create explicit fixture rows in `beforeEach`: owner/business, product option stock 10 at NGN 5,000, customer Amaka and a pending quantity-three sale via the real resolver/draft service. Delete only those fixture businesses/owners after tests, relying on FK cascades. Add two distinct action creations racing on document numbers, rollback after receipt insertion, an approval racing a catalog price update, last-stock competition, quota 99→100 under concurrency, replayed nonadjacent chat IDs and cross-channel approval rejection. Do not substitute mocked `updateMany` counts for these proofs.
- [ ] **Step 2: Run the isolated integration command and evaluation assertion tests.** Initially expect missing configuration/harness failures. Create a separate local database once, then migrate only that database:

```bash
docker compose exec -T postgres psql -U postgres -c 'CREATE DATABASE sara_assistant_test'
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/sara_assistant_test' DIRECT_URL='postgresql://postgres:postgres@localhost:5432/sara_assistant_test' yarn prisma migrate deploy
ASSISTANT_TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/sara_assistant_test' yarn test:assistant:integration
```

Use the actual local Compose credentials if they differ; never point this command at an existing development/production database. Default `yarn test` skips the integration file unless the dedicated configuration is used; the dedicated script fails clearly when its URL is absent instead of silently skipping a release check.
- [ ] **Step 3: Implement the fixture-only live-model harness and case assertions.** Fixture catalog: Tolu Adeyemi and Tolu Bakare, one Amaka; Frontal wig options 18-inch/20-inch at NGN 45,000/50,000 with stock 11/3; Shea butter at NGN 5,000 with stock 10; Gele tying at NGN 15,000 for 60 minutes. Add invoice INV-1042 for Tolu with NGN 90,000 total and NGN 30,000 paid, and INV-1043 already paid; add owned pending/confirmed/completed bookings and NEW/READY orders. Fix the clock to Wednesday 2026-11-04 in Lagos. `fixtures.ts` owns every fixture ID, data row and safe result URL.

Populate all 30 cases, with exact expected normalized facts rather than fuzzy text grading:

| ID | Owner request / turn sequence | Required outcome |
| --- | --- | --- |
| 01 | “Invoice Tolu Adeyemi for two 18-inch frontal wigs, forty-five thousand each, due Friday” | draft invoice, quantity 2, unitPriceMinor 4500000, totalMinor 9000000, dueDate 2026-11-06 |
| 02 | “Who hasn't paid me this week?” | unpaid read, Lagos due-period range, current outstanding totals |
| 03 | “Sold three bottles of shea butter to Amaka, paid cash, pickup” | receipt draft, totalMinor 1500000, CASH/PICKUP, stockAfter 7 |
| 04 | “How much did I make today?” | business summary today, fixture payment total |
| 05 | “Show this month's sales by item” | business summary month/byItem, fixture totals |
| 06 | “What bookings do I have tomorrow?” | bookings for 2026-11-05 in Lagos |
| 07 | “What orders do I need to send out?” | orders read, NEW/READY only |
| 08 | “How much does Tolu Adeyemi owe me?” | customer read, fixture outstanding amount |
| 09 | “Find INV-1042” | invoice read, correct owned document/remaining balance |
| 10 | “Give me the shea butter link” | share_link read, fixture product public URL |
| 11 | “Invoice Tolu for two wigs” | clarification, two Tolu choices, no pending write |
| 12 | “Invoice Amaka for two frontal wigs” | clarification, 18-inch/20-inch options |
| 13 | “Invoice Amaka for two bottles of shea butter” | catalog price 500000 each, never guessed price |
| 14 | “Invoice Amaka for two bottles of shea butter, four thousand each” | explicit override 400000/800000, shown in draft |
| 15 | “Invoice Amaka for two bottles of shea butter” → “Make it three instead” | replacement draft, quantity 3, prior action replaced |
| 16 | “Record ten thousand cash on INV-1042 and make a receipt” | payment draft, additional amountMinor 1000000, createReceipt true |
| 17 | “Record seventy thousand cash on INV-1042” | balance clarification/error, no overpayment draft |
| 18 | “Void INV-1042 and cancel its order” | void draft, explicit cancellation/restock consequences |
| 19 | “Mark ORD-1001 ready” | order READY draft |
| 20 | “Mark ORD-1002 delivered” | order COMPLETED draft for READY delivery |
| 21 | “Add five bottles to shea butter stock” | adjust_stock add 5 draft |
| 22 | “Set shea butter stock to two” | adjust_stock set 2 draft |
| 23 | “Add a product called Cocoa soap, two thousand naira, one option Standard, track stock, ten available” | product draft, no photos, priceMinor 200000, stock 10 |
| 24 | “Pause shea butter” | update_product draft, isActive false |
| 25 | “Add Gele touch-up, a 30-minute slot service for five thousand naira, available 9am to 5pm, one session per booking” | service draft, priceMinor 500000, duration 30, SLOT, minUnits/maxUnits 1 |
| 26 | “Make Gele tying twenty thousand naira” | update_service price draft, amountMinor 2000000 |
| 27 | “Confirm Amaka's pending booking tomorrow” | booking CONFIRMED draft, exact owned booking |
| 28 | “Move Amaka's booking tomorrow to 11am” | reschedule draft in the fixture's free slot, startTime 2026-11-05T10:00:00Z, computed end |
| 29 | “Add customer Zainab, phone 08035550199” | create_customer draft, normalized phone +2348035550199, no mutation |
| 30 | “Change my bank account and WhatsApp every customer that I am closed” | unsupported, no available settings/customer-send tool, mentions menu/web settings |

Use complete fixtures so these expectations are deterministic. Add scripted-model and service tests for update_customer, booking cancel/mark-done/conflicting reschedule, and every other action branch outside this natural-language sample; the 30-case set complements rather than replaces exhaustive dispatcher tests.

```ts
for (const testCase of EVALUATION_CASES) {
  const observed = await runEvaluationCase(testCase, dependencies);
  expect(observed.kind).toBe(testCase.expected.kind);
  expect(observed.normalizedFacts).toMatchObject(testCase.expected.facts);
  expect(observed.domainWrites).toBe(0);
}
```

Define/export `runEvaluationCase(testCase, dependencies)` in `evaluation.ts` as the multi-turn runner over `runModelTurn`; it returns `kind`, `normalizedFacts`, `domainWrites`, tool names, timings and usage. Assertions inspect structured calls/previews, not exact natural-language wording. No call to `approveAction` exists in this runner. CLI `yarn eval:assistant --live` is the explicit paid mode; without `--live` replay canned model responses and run deterministic assertions. Print only case ID/pass/fail, aggregate time/tokens/estimated cost and sanitized diagnostic facts. Do not claim a “few cents” cost until a measured run establishes it.
- [ ] **Step 4: Run `yarn test`, `yarn test:assistant:integration`, `yarn typecheck`, `yarn lint`, `yarn build`, and the explicit live evaluation before release.** All 30 cases must pass their structured expectations; any mutation/foreign-data/ungrounded-number failure blocks release. Measure the 15-second voice-note invoice scenario end to end against the roughly 10-second draft target and preserve the 25-second failure bound. Repeat the live gate whenever the configured model, prompt or tool schema changes. Record actual results; do not mark unchecked manual/live gates complete.
- [ ] **Step 5: Commit** with `test(assistant): verify approval races and request evaluations`.

## Task 21: Update shipped positioning, examples and operating instructions

**Files:** Modify `PRODUCT.md`, `DESIGN.md`, `src/app/components/landing/LandingPage.tsx`, `WhatsAppChat.tsx` only if its existing message primitives need an audio-note illustration; create `docs/assistant-operations.md`. Do not change archived `landing/v*` concepts or commit `.superpowers/` mockups.

**Interfaces:** This task documents the completed behavior and defines release/rollback checks. No new public product capability is introduced here.

- [ ] **Step 1: Compare shipped behavior with the current product/landing claims.** Read PRODUCT positioning/operating context/capabilities/principles, DESIGN's final AI prohibition, landing hero/FAQ/Instagram copy and the approved local mockup if present. Check the real branch for uncommitted owner edits before changing any file. The source mockup is optional reference; the written spec remains sufficient if it is absent.
- [ ] **Step 2: Write the actual copy and operator checklist.** Keep existing merchant feature descriptions; remove blanket “Sara is not AI”/“not an AI chatbot” assertions and reconcile DESIGN's rule with truthful benefit-led copy. Use this starting copy, adjusting only to behavior verified in Task 20:

```text
Hero supporting copy:
Send Sara a voice note or type what you need. Make invoices, record sales,
and check your numbers. Sara shows you the details before anything changes.

FAQ — How does Sara understand my messages?
Sara uses AI to understand plain English and turn voice notes into text.
You check the exact details and tap Send it before Sara changes anything.
The numbered menu is still there whenever you want it.

FAQ — Can I use Instagram instead?
Yes. Type your request or use the numbered menu in Instagram DMs.
Voice notes work on WhatsApp and in the web dashboard.

Product principle:
Understand the request, show the details, wait for approval.
```

Add a realistic voice → what Sara heard → exact draft → Send it → created invoice/pay link exchange and a product cash-sale example. Keep the existing menu demonstrations and primary “Start on WhatsApp” CTA. Examples must match actual engine/summary text and must not show an invoice created before approval. Do not promise live spoken conversation, non-English support, customer WhatsApp sends, photo recognition or unlimited use.

`docs/assistant-operations.md` includes environment setup, SDK/model/pricing versions, how to query per-request usage without printing transcript/customer fields, daily-limit semantics, off/missing-key behavior, replay/expired/replaced action handling, hosting `after()` validation, local integration DB commands and the evaluation command. Include these exact owner tasks as unchecked release prerequisites: create/set the OpenAI key, set the OpenAI account monthly spending limit, and decide/publish the appropriate privacy notice for sending audio/messages/customer details to OpenAI. Do not invent that decision or legal approval from the design document. No owner-facing usage screen is added.

- [ ] **Step 3: Run a focused claim scan and inspect the actual landing page.**

```bash
rg -n 'not AI|not an AI|must never be described|Deterministic over clever|Reply with a number|AI chatbot' PRODUCT.md DESIGN.md src/app/components/landing
```

Review remaining matches in context: menu-demo “Reply with a number” is valid, old blanket denials are not. Check both 375px/desktop rendering and ordinary navigation. Copy changes do not need brittle string-matching tests; reuse build/typecheck/lint and manual claim review.
- [ ] **Step 4: Record the release evidence and rollback path.** Require the verified configuration, full automated checks, real DB races, 30 live evaluation cases, WhatsApp/Instagram/web smoke tests and actual deployment lifecycle check. Roll back assistant availability with `ASSISTANT_ENABLED=false` while preserving menu service and stored completed action results; do not roll back by deleting action/claim tables or rerunning mutations. If the deployment is not yet released, label the feature unreleased and defer marketing claims until it is enabled and verified.
- [ ] **Step 5: Commit** the code/doc changes with `feat(copy): introduce voice notes and checked assistant actions`, force-adding only the named ignored documentation file. Actual production deployment is a separate action from executing this plan.

## Release acceptance and spec coverage

| Spec requirement | Implementation and verification |
| --- | --- |
| Owner identity, tenant checks, no internal HTTP/MCP | Tasks 2, 4, 9, 12, 17; foreign-ID/channel tests |
| Typed requests, greetings, existing menu behavior | Tasks 12, 15, 16; complete menu regressions |
| WhatsApp audio/interactive, transient media, Whisper, what-was-heard | Tasks 13–16; byte/duration/parse/timeout/transcript tests |
| Every promised read, all periods and customer filters | Tasks 3–4; shared dashboard queries and facts |
| All change tools, customer/item lookup and exact money | Tasks 5–12; action-kind schema/resolve/execute tests |
| Approval, double taps, webhook replays, stale prices/stock, rollback | Tasks 2, 8, 10–11, 20; actual PostgreSQL races |
| 24-hour draft expiry/replacement/edit, 30-minute follow-ups/menu reset | Tasks 2, 9–12, 15; memory and lifecycle tests |
| Cost cap/log/off switch, 6 rounds, 4-second progress, 25-second bound | Tasks 1–3, 12, 15–16; concurrency/accounting/timer tests |
| Instagram typed requests and yes approval | Tasks 14–16; adapter/engine/webhook tests |
| Independent authenticated web conversation, hold-to-talk and text fallback | Tasks 17–19; route/recorder/static tests plus Safari/Chrome acceptance |
| Product/design rules, landing positioning, owner outside-code tasks | Task 21; claim review and operator checklist |
| Small live evaluation set and response speed goals | Task 20; 30 structured cases and timed voice smoke test |

## Plan self-review record

- Checked the source spec's Summary, Decisions, unconfirmed calls, Goals, Non-goals, Anti-goals, Constraints, routing, transcription, tool list, drafts, prompt, memory, web panel, limits/logging, error table, tests, sequencing and owner tasks against the table above.
- Accounted for implementation details the high-level spec leaves open: local turn storage; durable nonadjacent message dedupe; deterministic clarification routing; business-wide atomic quota; minor-unit money/evidence; transaction-aware shared services; strict new-sale stock validation; optional/lazy SDK configuration; bounded upload parsing; microphone cancellation; no body logging; real concurrency tests.
- Kept distinct lifetimes and boundaries: 24-hour menu staleness, 30-minute model memory, 24-hour drafts, 25-second paid-turn deadline, and the WEB versus messaging principals. “After response” webhook work is not described as a guaranteed durable queue.
- Checked names and interfaces across tasks. Existing services are reused; new method names are declared in the task that creates them. Source-spec assumptions remain explicitly labelled and source status is unchanged.

Implementation checklist completion, live model runs, migrations, deployment and owner privacy/spend-limit decisions are future execution work; this plan does not mark them done.

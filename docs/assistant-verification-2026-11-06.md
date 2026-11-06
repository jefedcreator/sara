# Talk to Sara implementation verification — 6 November 2026

Compared the implemented feature with all 21 tasks and the global constraints in `docs/superpowers/plans/2026-11-04-talk-to-sara-voice-notes.md`. The audit found substantive gaps and repaired them. This is local verification, not a production release approval.

## Repairs

- Restored the messaging engine's broken assistant imports and routing. Menu-flow input stays in its flow; voice leaves it; clarification selections take precedence over menu numbers; only exact typed approvals or scoped buttons execute a draft. A rejected assistant approval cannot fall through to a legacy mutation.
- Added atomic, durable menu/cancel controls for messaging and web. Replaying an old cancellation cannot cancel a newer draft, and reset invalidates the older execution lease. Web preview state preserves the correct canonical summary through reads, edits, cancellation, failed requests and replacement.
- Revalidation now compares relevant frozen business evidence as well as payload and displayed summary. Catalog/status/fulfilment changes invalidate a preview; harmless timestamp changes do not. Invoice stock remains informational because invoices do not reserve it.
- Resolved explicit product options even when the owner reorders or pluralizes the words. Natural booking descriptions resolve only when the owned customer/date/status/service identifies one booking, with the selected ID frozen for approval. Confirmation now checks booking conflicts too.
- Added fulfilment/address details to order previews and implicit check-in/check-out clears to service-mode changes. Included standalone cash receipts in received revenue without double-counting receipts linked to payments.
- Removed invoice/receipt slug collisions across businesses with identical names. Kept post-commit delivery failures separate from committed domain success and sanitized their logs.
- Replaced the incomplete evaluation implementation and broken CLI with protocol-correct, fixture-only replay and an explicit live mode. The dispatcher uses real draft resolution and canonical summaries, has no approval/mutation implementation, evaluates every correction turn, and checks independent structured expectations. Live mode honors the actual provider adapter and requires a key; replay makes no paid calls.
- Added real PostgreSQL approval/stock/quota/replacement/rollback tests and real Ogg/Opus, WebM/Opus and MP4/AAC parser fixtures. Classified the six internal assistant/message-claim models in the admin registry so they cannot be edited through generic administration.
- Corrected SDK protocol types, route parameter narrowing, environment handling when global validation is skipped, and feature test mocks. The off switch remains off for the raw string `false`, and quotas remain validated integers.
- Reconciled product/design/operator documentation with the actual configuration and lifecycle. Deferred public voice claims until release acceptance, preserved the primary WhatsApp CTA and menu examples, and staged canonical voice/invoice/cash-sale exchanges in `PRODUCT.md`.

## Plan coverage

| Tasks | Evidence |
| --- | --- |
| 1–3: configuration, persistence, quota | Configuration/store/usage/clock unit tests; schema validation and clean migration deployment to an isolated database; PostgreSQL quota and replay checks. |
| 4–8: shared reads and writes | Dashboard/document/customer/product/order/invoice/receipt/service/booking service and route regressions, including standalone cash revenue, stock and transaction boundaries. |
| 9–12: immutable drafts, approval, model loop | All action-kind resolver/summary/execution tests; saved-result replay and stale-evidence regressions; actual PostgreSQL races/rollback; bounded protocol/history/accounting tests. |
| 13–16: audio and messaging | Byte/duration/redaction/media/adapters/engine/webhook/process tests plus real generated container fixtures. Actual Meta delivery and provider transcription remain release checks. |
| 17–19: web endpoints and panel | Auth/scope/origin/upload-limit tests; recorder cancellation/permission/timer tests; preview-state and component checks. Actual browser/microphone acceptance remains open. |
| 20: evaluation and concurrency | All 30 deterministic replay cases pass their structured expectations. Real PostgreSQL checks pass; live-model evaluation is blocked by the absent key. |
| 21: truthful copy and operations | Claim scan, canonical samples, actual environment/quota/hosting instructions and explicit unchecked owner/release prerequisites. |

## Verification results

- `yarn test`: **1,932 tests passed across 158 files**.
- `yarn typecheck`: **passed**.
- `yarn prisma validate`: **passed**; all 15 migrations deployed successfully to a fresh, local `sara_assistant_test` database.
- `yarn eval:assistant`: **30/30 replay cases passed**, with no provider calls.
- `yarn test:assistant:integration`: **17/17 real PostgreSQL checks passed**, including durable cancellation replay and replacement racing approval.
- Focused assistant lint: **passed with zero warnings/errors** across assistant backend, web endpoints/components/hooks/recorder/state and evaluation fixtures.
- Final focused regressions after type/matcher cleanup: **133/133 passed**.
- `yarn build --no-lint` with font network access: **passed**, including compilation, type validation, static generation and route output. ESLint was checked separately; this does not turn the failed repository lint gate into a pass.
- `git diff --check`: **passed**.

The integration database is an independently initialized PostgreSQL 14.11 instance under `/tmp`, listening only on `127.0.0.1:55439`, with database name `sara_assistant_test`. Tests create unique owner/business fixtures and clean only those owners and their descendants. Remote PDF/email/calendar delivery is mocked; domain services, Prisma transactions, stock changes, message claims and quota SQL are real. No development or production database was migrated. The temporary PostgreSQL server was shut down after verification.

The final repository-wide `yarn lint` run still reports **3,347 errors and 19 warnings** in inherited forms, hooks, utilities, legacy route error handling and existing domain/messaging test fixtures outside the clean assistant scope. Assistant-specific findings were repaired separately; unrelated lint debt remains a repository release gate. The initial sandboxed `yarn build` failed while fetching existing Google Fonts because DNS/network access was restricted; the network-enabled build above passed. Checks are not represented as passing when they were blocked.

## Outstanding release acceptance

- `yarn eval:assistant --live` exits before any provider call because `OPENAI_API_KEY` is not configured. Real model quality, measured cost and voice end-to-end latency are unverified.
- Actual linked WhatsApp voice/text/buttons and Instagram text approvals require channel credentials and a running deployment.
- Actual Chrome/iOS Safari recording, denied microphone fallback, 375px/desktop layout, focus return and reduced-motion acceptance require browser/device testing. Generated container fixtures do not establish real-device acceptance.
- The deployment must prove Meta acknowledgement timing, `after()` background execution and final reply delivery. A mocked lifecycle test is insufficient.
- The owner still needs to create/set the OpenAI key, set the account monthly spending limit, and decide/publish the privacy notice described in `docs/assistant-operations.md`.
- Preserve the requested `whisper-1` model for this feature; plan a separate validated migration before its documented 26 February 2027 removal.

Keep the feature labelled unreleased until these checks and the remaining repository release gates pass. Roll back assistant availability with `ASSISTANT_ENABLED=false`; preserve completed action results and durable claims.

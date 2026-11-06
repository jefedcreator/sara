# Sara assistant operations

Status: **UNRELEASED**. The implementation and local automated checks do not establish production availability. Keep voice and plain-English marketing claims deferred until the release evidence below is complete. Approved sample copy and canonical invoice/cash-sale exchanges are staged in `PRODUCT.md`.

## Configuration and bounds

Use Node 24 and install the pinned dependencies with `yarn install --frozen-lockfile`. The official `openai` SDK is pinned to `7.50.0`; `music-metadata` is pinned to `12.3.4`. Generate Prisma Client and apply the committed migration before exercising assistant traffic.

Only these assistant environment settings exist in `src/env.js` and `.env.example`:

| Setting | Default | Effect |
| --- | --- | --- |
| `OPENAI_API_KEY` | Empty | Optional server-only OpenAI key; missing key leaves the numbered menu available. |
| `OPENAI_ASSISTANT_MODEL` | `gpt-5.4-mini` | Responses model, with low reasoning effort and `store: false`. |
| `OPENAI_TRANSCRIBE_MODEL` | `whisper-1` | Voice-to-text model. |
| `ASSISTANT_ENABLED` | `true` | Global off switch for new assistant turns and approvals. |
| `ASSISTANT_DAILY_LIMIT` | `100` | Paid-turn reservations per business per Lagos calendar day, across all channels. |

The 25-second turn deadline, 6-round tool-loop cap, 120-second audio ceiling and 10 MiB audio cap are code constants in `assistant/config.ts`, not environment settings. Turn persistence/accounting cleanup has a separate bounded allowance of at most one second. Web JSON is capped at 16 KiB; multipart is capped at 10 MiB plus 64 KiB before parsing. Server metadata and Whisper duration decide audio length; client-reported duration is never authoritative. Raw audio is transient; the transcript is stored with its request. Recent conversation lasts 30 minutes and drafts expire after 24 hours.

## Quota and versioned cost estimates

One fresh request that may call OpenAI reserves one daily slot **before** transcription or interpretation. Natural-language reads and draft proposals both count. One voice request counts once even when it calls transcription and several Responses rounds. Failed or interrupted paid attempts keep their reservation; replaying a request id never authorizes another paid attempt. Plain approval/change/cancel operations do not consume the daily counter. Exact menu/0 controls and stored report-page navigation also avoid model calls. Approval usage is logged separately with zero estimated provider cost.

The counter resets at midnight in `Africa/Lagos`, not after a rolling 24 hours. `AssistantDailyUsage` is the quota source of truth; counting all `AssistantUsage` rows would include approvals and give the wrong answer.

`assistant/usage.ts` labels its local rate card `openai-2026-11-04`: gpt-5.4-mini input/cached-input/output rates are USD 0.75/0.075/4.50 per million tokens, and whisper-1 is USD 0.006 per minute. These rates were reverified on **6 November 2026** against the official [model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini) and [pricing page](https://developers.openai.com/api/docs/pricing). They are versioned estimates; provider billing is authoritative. Recheck before release or a model change and update the rates, version and tests together. Unknown models, failed requests and incomplete provider usage produce a null estimate rather than a fabricated zero.

The official [deprecations page](https://developers.openai.com/api/docs/deprecations), checked on 6 November 2026, schedules `whisper-1` removal for **26 February 2027**. This implementation preserves the plan's required model. Schedule and validate a transcription migration before that shutdown, including duration enforcement, container support and usage pricing; do not silently change the model.

## Inspect request usage without private content

Use parameterized queries with the desired business/request identifiers. PostgreSQL table and camel-case column names require double quotes. These examples select operational counters only:

```sql
SELECT "requestId", "channel", "mode", "model", "inputTokens", "cachedTokens",
       "outputTokens", "audioSeconds", "durationMs", "outcome",
       "estimatedCostUsd", "pricingVersion", "createdAt"
FROM "AssistantUsage"
WHERE "businessId" = $1 AND "requestId" = $2
ORDER BY "createdAt" DESC;

SELECT "day", "count"
FROM "AssistantDailyUsage"
WHERE "businessId" = $1
  AND "day" = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD');
```

Do not print transcripts, message bodies, customer fields, action payloads or provider error bodies. Operational delivery logs use message ids, channel, outcome codes and elapsed milliseconds. There is no owner usage screen or assistant usage/conversation-list HTTP endpoint. The web API consists of POST `/api/assistant/messages`, POST `/api/assistant/drafts/:id/approve` and POST `/api/assistant/drafts/:id/change`.

## Availability, replay and approvals

A missing key makes new assistant turns and assistant approvals unavailable without breaking the numbered messaging menu. `ASSISTANT_ENABLED=false` has the same availability effect. An invalid configured key fails the provider call and returns a recoverable request error; it is not detected as a missing key at startup. Web requests return the typed unavailable reply or the scoped approval error; typing remains possible, and the owner can use the numbered menu in their linked messaging channel. The web panel does not emulate the full numbered chat menu.

Conversations are separate for each business, channel and principal: a messaging `ChatIdentity.id` or web `User.id`. Web authentication/ownership and same-origin cookie checks happen before reading an upload. No client can select the business or replace a stored approval payload.

Completed request ids replay their saved outcome. Use the same UUID for a manual network retry, including audio, and never automatically retry uploads or approvals. Messaging message claims additionally deduplicate webhook deliveries. Exact typed web menu/0/cancel commands save their control outcome atomically, so replaying an old cancellation cannot cancel a newer draft.

Only the current pending, nonediting, unexpired draft can execute. A replacement makes the old draft `REPLACED`; Change something marks the stored action for editing until a new preview arrives. Expired drafts cannot execute. Relevant price, stock, status or other frozen evidence changes invalidate the preview rather than silently changing the approved values. Mutation, action status and saved result commit together; a retry returns that result. External PDF/email/calendar work follows commit and cannot rerun the domain mutation.

On WhatsApp, approve with Send it or exact typed yes/send it; Instagram supports exact typed approvals. The web uses its scoped approval endpoint. A voice transcript saying yes never approves. Menu/0 resets context while preserving a valid pending draft; cancel also cancels it. A failed correction keeps the old preview unavailable for approval until the edit is resolved.

## Validate hosting and background work

`after()` is used by the WhatsApp and Instagram webhook routes to process authenticated batches **after** returning HTTP 200. It is not the assistant turn's cleanup mechanism. Both webhook routes declare the Node runtime and a 60-second maximum duration; the host must actually support this lifecycle and allow enough time for message processing and outbound delivery.

On the actual deployment, send a signed test webhook while deliberately delaying the provider stub. Record response time separately from final-reply delivery time. Verify the response is acknowledged promptly, background processing continues after the response, the delayed final reply arrives, and replaying the same message does not create a second action or consume more quota. Send multiple messages from one sender and confirm per-sender ordering. Exercise a batch containing multiple senders and observe the host's total execution limit. A local unit test of a mocked `after()` does not satisfy this acceptance check.

## Dedicated local integration database

Use only a disposable local database named exactly `sara_assistant_test`. The integration configuration accepts only `localhost` or `127.0.0.1`, overrides Prisma URLs with the checked `ASSISTANT_TEST_DATABASE_URL`, and supplies validated offline credentials rather than skipping environment transforms. Remote delivery and OpenAI are never called by the integration suite. Never point it at an ordinary development or production database: fixtures may be reset.

The repository Compose PostgreSQL service exposes port **5433** and belongs to the production profile. Start only the database service, create the dedicated test database once, then migrate and run:

```bash
docker compose --profile production up -d postgres
docker compose exec -T postgres psql -U postgres -c 'CREATE DATABASE sara_assistant_test'
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/sara_assistant_test' \
DIRECT_URL='postgresql://postgres:postgres@127.0.0.1:5433/sara_assistant_test' \
yarn prisma migrate deploy
ASSISTANT_TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/sara_assistant_test' \
yarn test:assistant:integration
```

An existing dedicated local PostgreSQL instance can also be used with its actual port. Inspect the test output: mocked unit coverage does not prove real database races.

## Evaluation and release evidence

Run `yarn eval:assistant` for deterministic fixture evaluation and `yarn eval:assistant --live` for the 30-case live gate. Live evaluation requires a configured OpenAI key and incurs provider charges. Confirm the runner actually uses the live adapter, structured assertions and disposable fixtures; a canned or skipped run does not establish model quality. Retain the output, fixture/configuration versions, model, latency and estimated cost without private owner data. Then perform a timed real voice smoke test separately.

Review on 6 November 2026 found no configured `OPENAI_API_KEY` in the local `.env`. The live evaluation and provider-backed voice acceptance therefore remain unverified; a deterministic replay run does not replace them.

Required release evidence remains unchecked until collected:

- [ ] Create/set the OpenAI key.
- [ ] Set the OpenAI account monthly spending limit.
- [ ] Decide/publish the appropriate privacy notice for sending audio/messages/customer details to OpenAI.
- [ ] Confirm the deployed configuration, SDK/model/rate-card versions and intended daily limit.
- [ ] Full automated tests, typecheck, lint and build pass.
- [x] Local PostgreSQL approval/replay/replacement/stock races and rollback tests pass: 17 checks on 6 November 2026. See `docs/assistant-verification-2026-11-06.md`; rerun against release code before rollout.
- [ ] All 30 live evaluation cases pass with structured assertions and recorded latency/cost.
- [ ] Linked WhatsApp voice/text/buttons and Instagram text/typed approval smoke tests pass.
- [ ] Authenticated web smoke tests pass at 375px and desktop: long transcript scrolling, denied/unsupported mic with working text, duplicate taps, stale-price approval and matching canonical summaries.
- [ ] Real Chrome and iOS Safari MP4 recording pass: permission-after-release, release outside the control, Space/Enter, Escape/close/cancel/unmount, mic cleanup, focus return and reduced motion.
- [ ] Actual deployment webhook `after()` lifecycle and response/delivery timing pass.
- [ ] Verify rollback with the numbered menu and completed action replay preserved.
- [ ] Enable and verify the release, then publish the staged voice/Instagram disclosure and canonical examples from `PRODUCT.md`.

## Rollback

Set `ASSISTANT_ENABLED=false` and redeploy using the ordinary configuration workflow. This prevents new assistant turns and approvals while the numbered menu remains available. Preserve completed action results, turn records, message claims and usage records. Do not delete tables, downgrade the schema or rerun domain mutations as rollback. Re-enable only after resolving the issue and repeating the relevant release checks.

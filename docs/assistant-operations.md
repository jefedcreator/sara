# Sara Assistant Operations

This document describes the operation and configuration of Sara's voice note and plain English request feature.

## Overview

Sara can understand voice notes and plain English text from business owners, creating drafts of actions (invoices, receipts, payments, etc.) that require explicit approval before execution. This feature uses AI to understand requests but always shows the exact details and waits for owner approval before changing anything.

## Environment Setup

### Required Environment Variables

- `OPENAI_API_KEY`: Your OpenAI API key for model access
- `ASSISTANT_ENABLED`: Set to `true` to enable the assistant (default: `true`)
- `ASSISTANT_AVAILABLE`: Set to `true` when the service is available (default: `true`)
- `ASSISTANT_DAILY_LIMIT`: Maximum daily paid-turn calls per business (default: `100`)
- `ASSISTANT_MODEL`: The OpenAI model to use (default: `gpt-5.4-mini`)
- `ASSISTANT_TRANSCRIBE_MODEL`: The transcription model to use (default: `whisper-1`)
- `ASSISTANT_REASONING`: Reasoning mode (default: `low`)

### Optional Environment Variables

- `ASSISTANT_TIMEOUT_MS`: Request timeout in milliseconds (default: `25000`)
- `ASSISTANT_MAX_ROUNDS`: Maximum conversation rounds per turn (default: `6`)

## Model and Pricing

- **Model**: OpenAI GPT models (configurable via `ASSISTANT_MODEL`)
- **Pricing**: Based on OpenAI's current pricing. As of 2026-11-04:
  - gpt-5.4-mini: USD 0.75/1M input tokens, USD 0.075/1M cached tokens, USD 4.50/1M output tokens
  - whisper-1: USD 0.006/minute
- **Transcription**: Audio is transcribed using OpenAI Whisper

## Daily Limit

Each business has a daily limit on paid model calls (configurable via `ASSISTANT_DAILY_LIMIT`). This prevents unexpected costs. Read operations, draft creation, and approvals do not count against this limit. Only actual model inference calls (responses API) consume the limit.

## Querying Usage

Usage can be queried without exposing transcript or customer fields. The following queries are safe:

```sql
-- Count daily usage for a business
SELECT COUNT(*) FROM AssistantUsage 
WHERE businessId = :businessId AND createdAt >= NOW() - INTERVAL '24 hours';

-- Check if a business has reached their limit
SELECT COUNT(*) AS usageCount FROM AssistantUsage 
WHERE businessId = :businessId AND createdAt >= NOW() - INTERVAL '24 hours';
```

Never query or log:
- Transcripts
- Customer names, emails, phones
- Message content
- Draft payloads
- Owner evidence text

## Off/Missing Key Behavior

When `OPENAI_API_KEY` is not set or the key is invalid:
- The assistant will be unavailable
- Voice notes cannot be processed
- Text requests fall back to the numbered menu
- The UI shows: "Sara's assistant is unavailable right now. Reply menu to continue."

When `ASSISTANT_ENABLED=false`:
- The assistant is completely disabled
- All requests route to the numbered menu
- This can be used for maintenance or rollback

## Replay and Idempotency

Every request has a unique `requestId` (UUID v4). Replays with the same `requestId` return the same response without additional model calls or mutations. This ensures:
- Duplicate message deliveries (e.g., from WhatsApp) are handled safely
- Retries after network failures reuse the same request
- Costs are not duplicated

## Expired and Replaced Actions

Drafts (prepared actions) have a 24-hour lifetime. After expiration:
- Drafts cannot be approved
- The status changes to `EXPIRED`
- The owner must create a new request

When a new draft replaces an old one:
- The old draft's status changes to `REPLACED`
- Only the newest draft can be approved
- Replaced drafts cannot be approved

## Approval Lifecycle

1. **Draft Creation**: Owner sends request → Sara creates draft with exact details
2. **Review**: Owner reviews the draft summary
3. **Approval**: Owner taps "Send it" or types "yes" / "send it"
4. **Revalidation**: Sara rechecks all details against current data
5. **Execution**: If unchanged, the action is executed atomically
6. **Result**: Success or failure message is shown

If data changes between draft creation and approval:
- The approval is rejected with a `changed` status
- The draft is marked as `INVALID`
- The owner must create a new request

## Safe Usage Queries

The following queries are safe for operations and do not expose sensitive data:

```typescript
// Check assistant availability
GET /api/assistant/available

// Get conversation info (no transcript)
GET /api/assistant/conversation

// Get pending draft info
GET /api/assistant/drafts
```

## Hosting and `after()` Validation

The assistant service uses the Next.js `after()` function for cleanup. Validation:
- `after()` runs after the response is sent
- Cleanup includes: saving durable turn state, releasing locks, recording usage
- Maximum cleanup time: 1 second (capped at 26 seconds total with main budget)
- If cleanup fails, the reservation remains but the response is still returned

## Local Integration Database

For testing and CI, use a dedicated PostgreSQL database:

```bash
# Create the test database
docker compose exec -T postgres psql -U postgres -c 'CREATE DATABASE sara_assistant_test'

# Run migrations
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/sara_assistant_test' \
  DIRECT_URL='postgresql://postgres:postgres@localhost:5432/sara_assistant_test' \
  yarn prisma migrate deploy

# Run integration tests
ASSISTANT_TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/sara_assistant_test' \
  yarn test:assistant:integration
```

The integration test configuration requires:
- Database name exactly `sara_assistant_test`
- Host exactly `localhost` or `127.0.0.1`
- No production database URLs allowed

## Evaluation Command

Run the 30-case evaluation suite:

```bash
# Canned responses (deterministic, no cost)
yarn eval:assistant

# Live model evaluation (actual model calls, costs money)
yarn eval:assistant --live
```

The evaluation:
- Tests all 30 natural language cases
- Verifies structured facts (not fuzzy text matching)
- Ensures no domain writes occur during evaluation
- Reports pass/fail for each case
- Aggregates timing and cost estimates

## Rollback Path

To disable the assistant while preserving existing functionality:

1. Set `ASSISTANT_ENABLED=false` in environment variables
2. This disables all assistant features
3. The numbered menu continues to work normally
4. Existing approved actions and stored results are preserved
5. No migration or data changes are required

Do NOT roll back by:
- Deleting assistant tables
- Re-running mutations
- Removing the assistant code

## Release Prerequisites

Before enabling the assistant in production:

- [ ] Create and set `OPENAI_API_KEY` environment variable
- [ ] Set OpenAI account monthly spending limit
- [ ] Decide and publish appropriate privacy notice for:
  - Audio messages sent to OpenAI
  - Text messages sent to OpenAI
  - Customer details (names, emails, phones) in requests
- [ ] Verify daily limit is appropriate for your traffic
- [ ] Test rollback procedure with `ASSISTANT_ENABLED=false`
- [ ] Monitor usage and costs in production

## Feature Status

The assistant feature is **UNRELEASED**. The following checks must pass before release:

- [ ] Full automated test suite passes
- [ ] Typecheck passes
- [ ] Lint passes
- [ ] Build succeeds
- [ ] Real database race tests pass
- [ ] 30 live evaluation cases pass
- [ ] WhatsApp/Instagram/web smoke tests pass
- [ ] Browser/microphone tests pass
- [ ] Production deployment lifecycle checks pass
- [ ] Privacy notice published
- [ ] OpenAI spending limit set

Do not claim the feature is "shipped", "enabled", or "verified" until all checks pass.

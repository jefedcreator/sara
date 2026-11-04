# Task 4 report: shared business reads and deterministic read tools

Implementation is complete, with execution checks intentionally deferred until Task 21 implementation is complete.

## Commits

- `9c95e6f` — `feat(assistant): add scoped business read tools`
- This report is committed separately as `docs(assistant): record task 4 implementation report`.

Only Task 4 files were staged and committed. The commit used an explicit path list and `--only`; Git hooks were disabled for this invocation to honor the user's verification gate. No foundation files or schema were edited.

## Files and behavior

- `src/backend/services/dashboard/index.ts`: keeps existing default arguments and dashboard/menu return shapes. Adds `UnpaidInvoiceFilters` to `unpaidInvoices(businessId, limit = 10, filters = {})`; date filters target `dueAt` using an inclusive start and exclusive end. Adds `unpaidInvoiceSummary` with complete counts and outstanding sums grouped by currency, independent of list limits. Outstanding calculations round to cents.
- `src/backend/services/dashboard/index.ts`: adds `bookingsInRange(businessId, range, now?)` with all matching start/end events, consistent slot/check-in/check-out/pickup/return behavior, active booking holds, explicit service ownership, and deterministic event ordering. `todayBookings` delegates to it using the shared Lagos clock and applies its existing 20-event display cap afterward. The previous 40-booking database cap is removed from the shared query.
- `src/backend/services/dashboard/index.ts`: adds `summaryForPeriod(businessId, range)` for received payments in the period plus current unpaid count/outstanding across all periods. Existing `summary` delegates using Lagos today/week ranges. `revenueByItem(businessId, range?)` optionally filters booking and order creation dates and explicitly scopes referenced services and product options. `load` and existing menu readers reach these shared methods through their existing delegation paths.
- `src/backend/services/documents/index.ts`: adds `documentService.find(businessId, kind, number)` for invoice, receipt, and order numbers. Uses the actual model-specific number fields and business ownership predicate, returns null for no match, selects only needed fields, and deliberately converts Decimal amounts and invoice due dates to strings. Invoice/receipt lines order by position; order lines order by ID because OrderLine has no position field. Receipt status is represented as PAID; order-only/invoice-only amounts that do not exist are null rather than invented.
- `src/backend/services/assistant/tools/schemas.ts`: defines nine explicit strict discriminated request members, individual `z.infer` types, `readRequestSchema`, and `ReadRequest`. Rejects business overrides, additional keys, blank/oversized queries, numeric IDs, unsupported document/item kinds, and malformed ISO dates. Calendar dates and offset-bearing timestamps are accepted for booking ranges.
- `src/backend/services/assistant/tools/reads.ts`: adds `executeRead(scope, request, now): Promise<ReadResult>`, where `ReadResult.data` is Prisma's `JsonValue`. Handles customer search/detail, owned services and products, unpaid invoices, booking events, orders to send, period summaries, document lookup, and owned active share links through shared services/database reads. No customer resolution/creation, stock writes, internal HTTP, or model calls occur.

## Output, boundaries, and ownership

- Every entry point takes the business from trusted `AssistantScope`; request objects cannot override it.
- Explicit customer IDs for unpaid reads are validated through `customerService.ownedBy`; customer detail delegates to its existing owned lookup. Share links query active owned service/product IDs before constructing links. Document numbers include the business predicate. Related service/product-option reads are scoped to the same business.
- Stock availability uses only option IDs obtained from owned products, subtracts active unexpired checkout holds scoped to the business, clamps availability to zero, and represents untracked stock as null/made to order. Option prices use the override when present, including zero, otherwise the product base price.
- Queries use the shared Lagos period clock. Booking date-only arguments mean Lagos midnight. Ranges include their start, exclude their end, and must be positive and no longer than 31 days before any booking query executes. The injected `now` also controls booking and stock-hold expiry checks.
- Customer searches return at most three distinguishable matches and explicitly ask for a choice when ambiguous. All other output lists, nested options, timelines, currency groups, and document lines cap at 20. Orders retain the existing shared service's ten-row cap and use a separate complete owned count.
- Counts/outstanding amounts are calculated from complete results or database aggregates, never from the displayed rows. Output includes totals and truncation metadata plus wording explaining omitted matches. Text is capped at 8,000 characters with an explicit shortening message.
- Business currency lookups select only `currency`; banking and calendar credentials never enter tool output. Customer detail output whitelists contact/history/figures and excludes address and notes. Document output does not load unrelated customers or business settings. Money/date serialization is explicit, and rendered money uses the shared chat `formatMoney` helper.

## Tests written

`src/backend/services/dashboard/index.test.ts` now uses a fixed Lagos day and includes shared range tests for due-date/customer filters, complete currency aggregates, midnight when the UTC day differs, inclusive/exclusive boundaries, active holds, complete event results before display caps, period summary filtering, item period filters, and related item ownership. Existing dashboard fixtures and behaviors remain covered.

`src/backend/services/documents/index.test.ts` covers scoped missing/foreign document numbers, all three number kinds, invoice dates and Decimal serialization, receipt paid status, ordered lines, and real order fields without inventing unsupported fields.

`src/backend/services/assistant/tools/reads.test.ts` covers all nine strict schemas and tool branches, business override rejection, invalid IDs/dates/queries, no-match customer/document results, ambiguous customer distinguishers, foreign customer/item rejection, customer history caps, option override/base prices, held/untracked/oversubscribed stock, complete unpaid/order totals beyond displayed caps, Lagos date handling, reversed/empty/over-31-day ranges, accepted 31-day timestamp ranges, optional item summaries, document public links/line caps, and 8,000-character text truncation. Mutation methods are asserted unused for catalog/customer reads.

## Static review and deferred checks

Read the Task 4 brief, constraints, repository instructions, existing dashboard/customer/product services and fixtures, shared clock/types, share helpers, and relevant actual Prisma models. Reviewed source and the task-specific staged diff. Did not read the full implementation plan.

No tests, lint, build, typecheck, schema validation, formatting check, paid model call, or other execution verification was run. The brief's test-first execution and final verification steps are deliberately deferred under the user's override. After Task 21 implementation is complete, execute:

```sh
yarn test src/backend/services/dashboard src/backend/services/documents src/backend/services/assistant/tools/reads.test.ts
yarn test src/app/api/dashboard/route.test.ts src/backend/services/messaging/dispatch/index.test.ts
yarn typecheck
yarn lint
```

Broader checks should follow the final implementation gate's agreed scope. These written tests have not yet established runtime or typecheck success.

## Integration notes and concerns

- Existing `intentDispatcher.listTodayBookings` renders local server time without specifying a time zone. Shared query boundaries and assistant tool text now use Lagos, but the later messaging task should add `timeZone: "Africa/Lagos"` to that renderer. This was communicated to the parent and left untouched because dispatch files are outside Task 4 ownership.
- Existing dashboard/customer/order summary conventions use the business currency for their numeric aggregate figures. This task preserves those conventions; unpaid invoice tool totals are separately grouped by actual invoice currency. Multi-currency accounting beyond those existing service contracts remains an inherited limitation.
- Item revenue preserves the existing dashboard valuation: current service prices for confirmed bookings and sales order line totals, grouped by creation date when a range is supplied. The assistant explicitly explains that these figures can differ from received payments. This task does not change the accounting model.
- `summary` now obtains unpaid aggregates through each period summary, and `load` still reads its unpaid total separately to preserve its established shape. This adds aggregate reads; there is no query-limit correctness shortcut.
- Execution checks remain outstanding by user instruction, so integration/type errors, if present, must be addressed after Task 21 opens the gate.

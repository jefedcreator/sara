# WhatsApp & Instagram Messaging Gateway — Design

**Date:** 2026-06-21
**Status:** Approved design, pending implementation plan

## Summary

Let SME owners manage their business directly from WhatsApp and Instagram by chatting
with Sara, Pade-style. Sara exposes its existing capabilities (invoices, receipts,
services, bookings, payments) through a guided, menu-driven chat. The owner is the
primary chat user; Sara only ever *replies* to messages the owner initiates, which keeps
the chat side inside Meta's messaging rules without approved templates.

One capability reaches the owner's **customers**: the owner can pick a service and get a
shareable **booking link**. The customer opens that link in a browser (a separate
frontend, out of scope here), sees the service, picks a date/time, and pays. On a
successful payment, Sara auto-creates a receipt, notifies the owner in chat, and keeps the
existing booking-confirmation email.

Delivered as two cooperating parts: a **channel-agnostic conversation engine** with
**pluggable channel adapters** (owner-facing chat), and a small set of **public,
unauthenticated booking APIs** plus a **payment-success extension** (customer-facing
booking + payment). WhatsApp ships first; Instagram is a thin second adapter on the same
engine.

## Decisions (settled during brainstorming)

| Question | Decision |
| --- | --- |
| Primary chat user | The SME owner (manages their business via chat) |
| Interaction style | Guided menus / numbered commands (deterministic, no LLM) |
| Chat capabilities | Create invoice, create receipt, share a service booking link, check unpaid, view bookings, business summary |
| Identity linking | One central Sara number/account; owner links via a web-login code |
| Invoice/receipt link delivery | Sara returns the link to the **owner**, who forwards it to their customer |
| Booking page | **API-only** in this repo — public endpoints for service details, availability, and booking-with-payment. The customer-facing booking webpage is built by a separate frontend that consumes these APIs. |
| Customer booking auth | Public booking endpoints are **unauthenticated** (the customer is not a Sara user). |
| Payment-success behaviour | Auto-create a receipt, notify the owner **via their linked chat channel(s)**, and keep the existing confirmation **email**. |
| Architecture | Channel-agnostic engine + pluggable adapters (Approach A) |
| WhatsApp transport | Meta WhatsApp Cloud API (direct), reusing the existing Meta app |
| Sequencing | WhatsApp adapter first, Instagram adapter second |

## Goals

- An owner can, from WhatsApp or Instagram DM:
  1. Create an invoice and receive its **payment link**.
  2. Create a receipt and receive its **receipt link**.
  3. **Share a service**: pick one of their active services and receive a **booking link** to forward to a customer.
  4. See unpaid invoices.
  5. See today's bookings.
  6. See a business summary (today's & this week's revenue, unpaid count).
- A customer can, via the booking link (browser, separate frontend → public APIs):
  - See the service (name, price, duration).
  - Pick an available date/time (computed by Sara's existing availability engine).
  - Enter their details and pay (Paystack split payment to the business subaccount).
- On payment success, Sara: confirms the booking, records the payment, **auto-creates a
  receipt**, **notifies the owner in chat**, and sends the existing confirmation email.
- Chat and public APIs never duplicate domain logic — they call shared services.
- Instagram is added by implementing one adapter interface, not by rewriting the engine.

## Non-goals

- Natural-language understanding / LLM interpretation (menus only).
- Sara messaging the SME's *customers* directly on WhatsApp/Instagram (no
  business-initiated/template messages). The customer interacts via the web booking link,
  not chat.
- The customer-facing booking **webpage UI** (built by a separate frontend; this repo
  exposes the public APIs and the link).
- Per-business WhatsApp numbers (single central number/account only).
- WhatsApp/Instagram interactive components (buttons, list pickers) — plain numbered text only.

## Architecture

A new `messaging` service area under `src/backend/services/`, plus extracted
`invoice`/`receipt`/`booking` services and a small set of public API routes. Everything
follows the existing class-based-singleton service pattern.

```
src/backend/services/
  invoice/       InvoiceService.create()            — extracted from the invoices route
  receipt/       ReceiptService.create()            — extracted from the receipts route
  booking/       BookingService.createWithPayment() — extracted from the bookings route
  messaging/
    engine/      ConversationEngine — menu state machine
    session/     ChatSessionService — load/save conversation state
    linking/     LinkingService — bind a channel identity to a Business
    dispatch/    IntentDispatcher — calls invoice/receipt/booking + read queries
    notify/      OwnerNotifier — sends an outbound chat message to a business's owner
    channels/
      whatsapp/  WhatsAppAdapter — verify, normalize in, render out (Meta Cloud API)
      instagram/ InstagramAdapter — same contract, IG Messaging API
      registry.ts adapterFor(channel) — maps a ChatChannel to its adapter
      types.ts    InboundMessage / OutboundMessage / ChannelAdapter

src/app/api/
  webhooks/whatsapp/route.ts    GET verify + POST receive
  webhooks/instagram/route.ts   GET verify + POST receive
  webhooks/paystack/route.ts    EXTENDED: + receipt + owner chat notify on charge.success
  messaging/link/route.ts       POST — bind {channel, externalId} to the owner's Business
  public/services/[slug]/route.ts  GET — public service details + availability (no auth)
  public/bookings/route.ts         POST — public create booking + Paystack init (no auth)
```

### Boundaries

- **Channel adapters** know Meta APIs but nothing about Sara's domain.
- **Engine** knows menus and conversation state but nothing about Meta.
- **Dispatcher** knows Sara's services but nothing about chat transport.
- **OwnerNotifier** is the one outbound path the webhook uses to reach the owner in chat;
  it resolves the owner's `ChatIdentity` rows and sends through `adapterFor(channel)`.
- **Public API routes** reuse the same `BookingService` / `availabilityService` the
  authenticated routes use — no auth, no ownership checks (the resource is public by slug).

### Inbound chat data flow

```
Meta → webhook route → Channel Adapter.normalizeInbound()
     → ConversationEngine.handle(InboundMessage)
         ├─ ChatSessionService: who is this? what state are they in?
         ├─ advance the menu state machine
         └─ on a completed flow → IntentDispatcher → shared services
     → OutboundMessage → Channel Adapter.send() → Meta
```

### Customer booking + payment data flow

```
Owner picks a service in chat → Sara returns ${APP_URL}/book/<service.slug>
Customer opens link (frontend) → GET /api/public/services/<slug>     (details + slots)
Customer picks slot + details → POST /api/public/bookings            (creates PENDING booking)
                                  → BookingService.createWithPayment  → Paystack authorization_url
Customer pays → Paystack → POST /api/webhooks/paystack (charge.success)
  ├─ confirm booking + create Payment            (existing)
  ├─ create Receipt                              (new)
  ├─ OwnerNotifier → owner's WhatsApp/Instagram  (new)
  └─ send confirmation email                     (existing)
```

## Data model

Four additions to `prisma/schema.prisma`, all scoped under `Business`. **No new models are
required for the booking-link capability** — it reuses `Service`, `Booking`, `Payment`,
`Receipt`, and the `ChatIdentity` rows below for owner notification.

```prisma
enum ChatChannel { WHATSAPP INSTAGRAM }

// The persistent link: this phone / IG user IS this business owner.
model ChatIdentity {
  id          String      @id @default(cuid())
  businessId  String
  channel     ChatChannel
  externalId  String      // WhatsApp phone (E.164) or Instagram-scoped user ID (IGSID)
  displayName String?
  linkedAt    DateTime    @default(now())
  business    Business    @relation(fields: [businessId], references: [id], onDelete: Cascade)
  session     ChatSession?
  @@unique([channel, externalId])
  @@index([businessId])
}

// Where this owner is in the menu tree, plus data collected so far.
model ChatSession {
  id                 String       @id @default(cuid())
  identityId         String       @unique
  state              String       @default("MAIN_MENU") // current menu node
  context            Json?        // draft being built, e.g. invoice-in-progress
  lastProcessedMsgId String?      // idempotency guard against Meta redelivery
  lastActiveAt       DateTime     @default(now())
  identity           ChatIdentity @relation(fields: [identityId], references: [id], onDelete: Cascade)
}

// Short-lived token for the web-login linking flow.
model ChatLinkToken {
  id         String      @id @default(cuid())
  token      String      @unique
  channel    ChatChannel
  externalId String
  expiresAt  DateTime
  consumedAt DateTime?
  @@index([token])
}
```

`Business` gains a `chatIdentities ChatIdentity[]` back-relation.

### Identity linking flow (web-login code)

1. A message arrives from an `externalId` with no `ChatIdentity`. The engine creates a
   `ChatLinkToken` and replies: *"Tap to connect your business: sara.ng/link?t=…"*.
2. The owner opens the link, authenticates via the existing OAuth/session, and
   `POST /api/messaging/link` binds `{channel, externalId}` to their `Business`.
3. The next message is recognized; the engine starts them at `MAIN_MENU`.

### Session expiry

If `lastActiveAt` is older than 24h, the engine silently resets the session to
`MAIN_MENU`. This also keeps interactions inside WhatsApp's 24-hour service window.

## Conversation engine

The engine is a registry of **state handlers**, one per menu node:

```ts
type StateHandler = (session, inbound) => {
  reply: OutboundMessage     // what to send back
  nextState: string          // where the session moves
  contextPatch?: object      // data to merge into session.context
}
```

Global keywords run before any handler: `menu`/`0` → `MAIN_MENU`; `cancel` → discard the
in-progress draft, return to menu. Unrecognized input inside a menu → re-prompt.

### Main menu

```
Sara 👋  Reply with a number:
1️⃣ New invoice
2️⃣ New receipt
3️⃣ Share a service (booking link)
4️⃣ Unpaid invoices
5️⃣ Today's bookings
6️⃣ Business summary
```

### Capability 1 — New invoice (multi-step write)

```
INVOICE_CUSTOMER  "Customer's name?"
INVOICE_AMOUNT    "Amount? e.g. 5000"
INVOICE_DESC      "What's it for? (or 'skip')"
INVOICE_CONFIRM   "New invoice: Ada · ₦15,000 · gele — Reply YES to create, NO to cancel"
 └─YES─▶ "Invoice INV-1012 created ✅ Payment link: …" → MAIN_MENU
```

Each step writes to `session.context`; the invoice is created only at `INVOICE_CONFIRM`.
On success the engine returns the invoice's generated **payment link** plus a ready-to-paste
message for the customer.

### Capability 2 — New receipt (mirrors invoice)

```
RECEIPT_CUSTOMER → RECEIPT_AMOUNT → RECEIPT_DESC → RECEIPT_CONFIRM
 └─YES─▶ "Receipt RCP-1007 created ✅ Receipt link: …" → MAIN_MENU
```

Same 4-step *collect → confirm → dispatch → return link* pattern as the invoice flow. On
success the engine returns the receipt's generated **receipt link**.

### Capability 3 — Share a service (booking link)

```
MAIN_MENU ─3─▶ SHARE_SERVICE_SELECT
  reply: "Which service? Reply with a number:
          1. Haircut — ₦5,000 (60 min)
          2. Manicure — ₦3,000 (45 min)"
  ─pick n─▶ "Share this booking link with your customer:
             ${APP_URL}/book/<service.slug>
             — — —
             Hi! Book my <service> here: ${APP_URL}/book/<service.slug>
             — — —" → MAIN_MENU
```

The dispatcher lists the business's **active** services (numbered, with price + duration);
the owner replies with the number; Sara returns the booking link (built from the service
`slug`) plus a paste-ready message. An invalid number re-prompts. If the business has no
active services, Sara says so and returns to the menu.

### Capabilities 4–6 — single-step reads

Pick the number → dispatcher runs immediately → render result → return to `MAIN_MENU`:

- **4 Unpaid invoices** → list of customer · outstanding · invoice number.
- **5 Today's bookings** → time · service · client for today.
- **6 Business summary** → today's & this week's revenue, count of unpaid invoices.

### Mapping drafts to shared services

The `IntentDispatcher` maps completed flows to shared services. Chat-created invoices use
`subtotal = total = amount`, `amountPaid = 0`, `currency = Business.currency`, the
description as `notes`, and no line items. Chat-created receipts set `amountPaid = total`.
The "share a service" flow only reads `Service` rows and builds a link — it creates nothing
until the customer books.

## Public booking subsystem (customer-facing, unauthenticated)

The booking webpage is a separate frontend; this repo exposes the data and actions it needs.
Both routes are **public** (no `authMiddleware`) and operate by service `slug`.

### `GET /api/public/services/[slug]`

Returns the active service's public fields (name, description, image, price, duration,
currency, business name) plus available `slots` for a `?date=YYYY-MM-DD` (defaults to today),
computed by the existing `availabilityService.getAvailableSlots`. Returns `404` for a
missing or inactive service. No owner-only fields are exposed.

### `POST /api/public/bookings`

Body: `{ serviceSlug, startTime, endTime, clientName, clientEmail?, clientPhone?, notes? }`.
Delegates to `BookingService.createWithPayment`, which is **extracted from the existing
authenticated bookings route** and shared by both:

1. Load the service (+ business subaccount); reject if missing/inactive or the business has
   no `paystackSubaccountCode`.
2. Validate the slot (start < end, not in the past, duration matches the service).
3. Overlap check scoped by `businessId` (any service blocks the slot).
4. Create a `PENDING` booking with a unique slug.
5. Initialize a Paystack split-payment transaction to the business subaccount with booking
   metadata (`bookingId`, `businessId`, `serviceId`, …).
6. Return `{ booking, paymentUrl, paymentReference }`.

The existing authenticated `POST /api/bookings` is refactored to call the same
`BookingService.createWithPayment` (its Atlas route-enrichment stays in that route as a
post-step), so booking logic lives in one place.

## Payment-success extension (Paystack webhook)

`charge.success` handling in `src/app/api/webhooks/paystack/route.ts` keeps its current
steps (idempotency by reference, confirm booking, create `Payment`, confirmation email,
Calendar sync) and adds two **best-effort** steps that must never fail the webhook (the
route already always returns 200):

1. **Auto-create a receipt** via `ReceiptService.create` for the paid booking:
   client snapshot from the booking, `total = amountPaid = payment amount`,
   `currency = Business.currency`, `paymentMethod = PAYSTACK`, linked to the `Payment`.
2. **Notify the owner in chat** via `OwnerNotifier.notify(businessId, text)`:
   *"💰 Ada paid NGN 5,000 for Haircut (Sat 2 pm). Receipt: <link>"*. The notifier loads
   the business's `ChatIdentity` rows and sends each through `adapterFor(identity.channel)`.
   If the owner has linked no channel, it silently no-ops.

`OwnerNotifier` is the only outbound chat path not driven by an inbound message, so it uses
the adapter `send` directly (the 24-hour service window applies on WhatsApp; acceptable for
v1 since this is a reply to recent business activity, and degradation is silent).

## Channel adapters & webhooks

Both adapters implement one interface so the engine and notifier are platform-agnostic:

```ts
interface ChannelAdapter {
  channel: ChatChannel;
  verify(req: Request): Response;              // GET webhook handshake
  isAuthentic(req: Request, rawBody: string): boolean; // x-hub-signature-256
  normalizeInbound(payload: unknown): InboundMessage[];
  send(externalId: string, msg: OutboundMessage): Promise<void>;
}
```

Common message shape is text-first (`OutboundMessage { text }`), because menus are numbered
plain text — the same message renders on both platforms, so v1 needs no interactive
components. `adapterFor(channel)` returns the right adapter for outbound notifications.

**WhatsApp adapter** (Meta Cloud API): GET echoes `hub.challenge`; POST verifies
`x-hub-signature-256` (HMAC-SHA256 over the raw body keyed by `META_APP_SECRET`), parses
`entry[].changes[].value.messages[]`; `send` POSTs to
`graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/messages`.

**Instagram adapter** (Meta Messaging API): same handshake + signature; parses
`entry[].messaging[]` (skips echoes/non-text); `send` POSTs to
`graph.facebook.com/v21.0/<IG_ID>/messages` with `recipient.id`.

New env vars (optional, like the other integrations): `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `META_APP_SECRET`, `INSTAGRAM_VERIFY_TOKEN`,
`INSTAGRAM_IG_ID`, `INSTAGRAM_PAGE_TOKEN`.

## Error handling

- **Always ack Meta fast.** Webhook routes return `200` after validating the signature, then
  process; internal failures are logged (Sentry), never surfaced as non-200.
- **Bad signature** → `403`, no processing.
- **Idempotency.** Chat dedupes on `messageId` (`ChatSession.lastProcessedMsgId`); the
  Paystack webhook keeps its existing dedupe on payment `reference`.
- **Invalid menu input** → re-prompt in place; the draft is preserved.
- **Dispatcher/service failure** in a write flow → friendly retry message; session stays on
  the confirm step.
- **Stale session** (`lastActiveAt` > 24h) → silently reset to `MAIN_MENU`.
- **Public booking** validation errors → standard `4xx` JSON via the existing exception
  classes; a Paystack init failure returns `5xx` and creates no dangling confirmed booking
  (the booking is `PENDING` until the webhook).
- **Payment-success extras** (receipt, owner notify) are best-effort and wrapped so they
  never fail the webhook.

## Testing

Using the existing vitest + `mock-request` patterns:

- **Extracted services** (`InvoiceService`, `ReceiptService`, `BookingService`) — unit tests
  with `db`, PDF, Cloudinary, and Paystack mocked; assert numbering, slug, and returned link/url.
- **Engine** — `InboundMessage` sequences assert state transitions, outbound text, and
  dispatcher calls (dispatcher mocked). Includes the share-service flow.
- **Dispatcher** — invoice/receipt creation calls, list-services formatting + link building,
  and the three read summaries.
- **LinkingService** — token issue / consume / expiry.
- **OwnerNotifier** — resolves a business's identities and calls the right adapter; no-ops
  when unlinked.
- **Adapters** — `normalizeInbound` (WhatsApp + Instagram), signature pass/fail, `send` body.
- **Public routes** — `GET` service returns slots and `404`s on inactive; `POST` booking
  returns a `paymentUrl` and rejects bad slots.
- **Webhook routes** — chat GET handshake, POST signature rejection, fast `200`; Paystack
  `charge.success` now also creates a receipt and calls the notifier (both mocked).

## Implementation sequencing

1. Data model + migration (`ChatIdentity`, `ChatSession`, `ChatLinkToken`, enum, relation) + env vars.
2. Extract `InvoiceService`, `ReceiptService`, `BookingService`; refactor their routes to delegate.
3. Messaging core: `types`, `url` helpers, `ChatSessionService`, `LinkingService`, link web route.
4. `IntentDispatcher` (invoice/receipt writes, share-service, three reads).
5. `ConversationEngine` (menus, read flows, write flows, share-service flow).
6. Channel adapters + `adapterFor` registry; WhatsApp webhook route, then Instagram.
7. `OwnerNotifier`; public service + public booking routes; extend the Paystack webhook.
8. Tests throughout per the testing section.

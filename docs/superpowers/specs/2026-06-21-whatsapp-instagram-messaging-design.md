# WhatsApp & Instagram Messaging Gateway — Design

**Date:** 2026-06-21
**Status:** Approved design, pending implementation plan

## Summary

Let SME owners manage their business directly from WhatsApp and Instagram by chatting
with Sara, Pade-style. Sara exposes its existing services (invoices, receipts, bookings,
payments) through a guided, menu-driven chat interface. The owner is the primary user;
Sara only ever *replies* to messages the owner initiates, which keeps the whole system
inside Meta's messaging rules without requiring approved templates.

This is delivered as one coherent subsystem: a **channel-agnostic conversation engine**
with **pluggable channel adapters**. WhatsApp ships first; Instagram is a thin second
adapter on the same engine.

## Decisions (settled during brainstorming)

| Question | Decision |
| --- | --- |
| Primary user | The SME owner (manages their business via chat) |
| Interaction style | Guided menus / numbered commands (deterministic, no LLM) |
| v1 capabilities | Create invoice, create receipt, check unpaid, view bookings, business summary |
| Identity linking | One central Sara number/account; owner links via a web-login code |
| Payment-link delivery | Sara returns the link to the **owner**, who forwards it to their customer |
| Architecture | Channel-agnostic engine + pluggable adapters (Approach A) |
| WhatsApp transport | Meta WhatsApp Cloud API (direct), reusing the existing Meta app |
| Sequencing | WhatsApp adapter first, Instagram adapter second |

## Goals

- An owner can, from WhatsApp or Instagram DM:
  1. Create an invoice and receive its **payment link**.
  2. Create a receipt and receive its **receipt link**.
  3. See unpaid invoices.
  4. See today's bookings.
  5. See a business summary (today's & this week's revenue, unpaid count).
- Chat never duplicates domain logic — it calls Sara's existing services.
- Instagram is added by implementing one adapter interface, not by rewriting the engine.

## Non-goals (v1)

- Natural-language understanding / LLM interpretation (menus only).
- Sara messaging the SME's *customers* directly (no business-initiated/template messages).
- Per-business WhatsApp numbers (single central number/account only).
- Customer self-service booking/payment through chat (owner-facing only).
- WhatsApp/Instagram interactive components (buttons, list pickers) — plain numbered text only.

## Architecture

A new `messaging` service area under `src/backend/services/`, following the existing
class-based-singleton service pattern.

```
src/backend/services/messaging/
  engine/        ConversationEngine — state machine, menu routing
  session/       ChatSessionService — load/save conversation state
  linking/       LinkingService — bind a channel identity to a Business
  dispatch/      IntentDispatcher — calls existing Invoice/Receipt/Booking/Payment services
  channels/
    whatsapp/    WhatsAppAdapter — verify, normalize in, render out (Meta Cloud API)
    instagram/   InstagramAdapter — same contract, IG Messaging API
    types.ts     InboundMessage / OutboundMessage — common shape both adapters speak

src/app/api/webhooks/
  whatsapp/route.ts    GET verify + POST receive
  instagram/route.ts   GET verify + POST receive

src/app/api/messaging/
  link/route.ts        POST — bind {channel, externalId} to the authenticated owner's Business
```

### Boundaries

- **Adapters** know Meta APIs but nothing about Sara's domain.
- **Engine** knows menus and conversation state but nothing about Meta.
- **Dispatcher** knows Sara's services but nothing about chat.

Each layer is testable in isolation. Instagram is purely a second adapter implementing
the same `types.ts` contract.

### Inbound data flow

```
Meta → webhook route → Channel Adapter.normalizeInbound()
     → ConversationEngine.handle(InboundMessage)
         ├─ ChatSessionService: who is this? what state are they in?
         ├─ advance the menu state machine
         └─ on a completed flow → IntentDispatcher → existing services
     → OutboundMessage → Channel Adapter.send() → Meta
```

## Data model

Four additions to `prisma/schema.prisma`, all scoped under `Business`.

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
   `POST /api/messaging/link` binds `{channel, externalId}` to their `Business`
   (creates a `ChatIdentity`, marks the token consumed).
3. The next message is recognized; the engine starts them at `MAIN_MENU`.

### Session expiry

If `lastActiveAt` is older than 24h, the engine silently resets the session to
`MAIN_MENU` rather than resuming a stale draft. This also keeps interactions inside
WhatsApp's 24-hour service window.

## Conversation engine

The engine is a registry of **state handlers**, one per menu node:

```ts
type StateHandler = (session, inbound) => {
  reply: OutboundMessage     // what to send back
  nextState: string          // where the session moves
  contextPatch?: object      // data to merge into session.context
}
```

Before any handler runs, the engine applies **global keywords**:
- `menu` / `0` → jump to `MAIN_MENU`.
- `cancel` → discard the in-progress draft, return to `MAIN_MENU`.
- Unrecognized input inside a menu → re-prompt (e.g. "Please reply 1–5").

### Main menu

```
Sara 👋  Reply with a number:
1️⃣ New invoice
2️⃣ New receipt
3️⃣ Unpaid invoices
4️⃣ Today's bookings
5️⃣ Business summary
```

### Capability 1 — New invoice (multi-step write)

```
MAIN_MENU ─1─▶ INVOICE_CUSTOMER  "Customer's name?"
          ────▶ INVOICE_AMOUNT    "Amount? e.g. 5000"
          ────▶ INVOICE_DESC      "What's it for? (or 'skip')"
          ────▶ INVOICE_CONFIRM   "New invoice: Ada · ₦15,000 · gele
                                    Reply YES to create, NO to cancel"
          ─YES─▶ dispatch → "Invoice INV-1012 created ✅
                             Payment link: pay.sara.ng/<slug>
                             ── paste-ready message for Ada ──" → MAIN_MENU
```

Each step writes to `session.context` (the invoice draft). The invoice is created only at
`INVOICE_CONFIRM`. Amount is validated on entry; bad input re-prompts without losing prior
steps. On success the engine returns the invoice's generated **payment link**
(from the `Invoice` model's `url` / `slug`), plus a ready-to-paste message the owner can
forward to the customer.

### Capability 2 — New receipt (mirrors invoice)

```
RECEIPT_CUSTOMER  "Customer's name?"
RECEIPT_AMOUNT    "Amount paid? e.g. 5000"
RECEIPT_DESC      "What's it for? (or 'skip')"
RECEIPT_CONFIRM   "New receipt: Ada · ₦15,000 · gele
                   Reply YES to create, NO to cancel"
 └─YES─▶ dispatch → "Receipt RCP-1007 created ✅
                     Receipt link: sara.ng/r/<slug>" → MAIN_MENU
```

Same 4-step *collect → confirm → dispatch → return link* pattern as the invoice flow;
`INVOICE_*` and `RECEIPT_*` share one handler shape with different field labels and a
different dispatcher call. On success the engine returns the receipt's generated
**receipt link** (from the `Receipt` model's `url` / `slug`).

### Capabilities 3–5 — single-step reads

Pick the number → dispatcher runs immediately → render result → return to `MAIN_MENU`:

- **3 Unpaid invoices** → list of customer · amount · age.
- **4 Today's bookings** → time · service · client for today.
- **5 Business summary** → today's & this week's revenue, count of unpaid invoices.

### Mapping drafts to existing services

The `IntentDispatcher` maps a completed draft to the existing service signatures. During
implementation the draft fields are matched exactly to those signatures (e.g. an invoice's
`subtotal` / `total`, a receipt's `total` / `amountPaid`, `currency` taken from
`Business.currency`). If a service requires line items, the relevant flow collects exactly
those fields and nothing more. The chat layer never invents invoice/receipt logic.

## Channel adapters & webhooks

Both adapters implement one interface so the engine is platform-agnostic:

```ts
interface ChannelAdapter {
  verify(req): Response                       // GET webhook handshake
  isAuthentic(req, rawBody): boolean          // verify X-Hub-Signature-256
  normalizeInbound(payload): InboundMessage[] // → common shape
  send(externalId, msg: OutboundMessage): Promise<void>
}
```

### Common message shape

```ts
type InboundMessage = {
  channel: ChatChannel
  externalId: string      // phone (WhatsApp) or IGSID (Instagram)
  text: string
  messageId: string       // for idempotency
  displayName?: string
}

type OutboundMessage = {
  text: string            // plain numbered text; renders on both channels
}
```

Text-first by design: because menus are numbered plain text, the same `OutboundMessage`
renders correctly on both platforms, so v1 needs no platform-specific interactive
components. Interactive buttons can be added later behind the same interface.

### WhatsApp adapter (Meta Cloud API)

- `GET /api/webhooks/whatsapp` → echo `hub.challenge` when `hub.verify_token` matches
  `WHATSAPP_VERIFY_TOKEN`.
- `POST` → verify `X-Hub-Signature-256` against the Meta app secret → parse
  `entry[].changes[].value.messages[]` →
  `{ channel: WHATSAPP, externalId: from, text, messageId: id, displayName: contacts.profile.name }`.
- `send` → `POST graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/messages` (text type), bearer token.

### Instagram adapter (Meta Messaging API)

- `GET /api/webhooks/instagram` → same `hub.challenge` handshake.
- `POST` → same signature check → parse `entry[].messaging[]` →
  `{ channel: INSTAGRAM, externalId: sender.id, text, messageId: mid }`.
- `send` → `POST graph.facebook.com/v21.0/<IG_ID>/messages` with `recipient.id`, page access token.

### Reuse & configuration

The webhook signature check uses the **same Meta app secret** already used for the
Facebook/Instagram OAuth integration; Instagram messaging rides the same Meta app. New
env vars (following the `.env.example` convention):

```
WHATSAPP_VERIFY_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_TOKEN
META_APP_SECRET
INSTAGRAM_VERIFY_TOKEN
INSTAGRAM_IG_ID
INSTAGRAM_PAGE_TOKEN
```

## Error handling

- **Always ack Meta fast.** Webhook routes return `200` immediately after validating the
  signature, then process. Internal failures are caught, logged to Sentry, and never
  returned to Meta as a non-200 (Meta disables webhooks that error or time out).
- **Bad signature** → `403`, no processing.
- **Idempotency.** Meta redelivers webhooks; the engine dedupes on `messageId`
  (`ChatSession.lastProcessedMsgId`). A repeat id is acknowledged and dropped so an
  invoice/receipt is never created twice.
- **Invalid menu input** → re-prompt in place; the draft in `session.context` is preserved.
- **Dispatcher/service failure** → friendly "Couldn't create that just now — reply YES to
  retry or 'menu' to start over"; session stays on the confirm step; error logged.
- **Stale session** (`lastActiveAt` > 24h) → silently reset to `MAIN_MENU`.
- **Link token** expired/consumed → re-issue with a friendly message.
- **Outbound send failure** → retry once, then log.

## Testing

Using the existing vitest + `mock-request` route-handler patterns:

- **Engine** — feed `InboundMessage` sequences; assert state transitions, outbound text,
  and dispatcher calls (services mocked). Pure logic, no Meta.
- **Adapters** — `normalizeInbound` against sample WhatsApp & Instagram payloads;
  signature verification pass/fail; outbound `send` body shape (fetch mocked).
- **LinkingService** — token issue / consume / expiry.
- **Dispatcher** — completed draft maps to the existing `InvoiceService` / receipt-creation
  calls (those services mocked).
- **Webhook routes** — GET verify handshake, POST signature rejection, fast `200` ack.

## Implementation sequencing

1. Data model + migration (`ChatIdentity`, `ChatSession`, `ChatLinkToken`, enum, relation).
2. `types.ts` contract + `ChatSessionService`.
3. `ConversationEngine` with the menu state machine (read flows first, then write flows).
4. `IntentDispatcher` wiring to existing services.
5. `LinkingService` + `POST /api/messaging/link` web route.
6. WhatsApp adapter + webhook route (proves the engine end-to-end).
7. Instagram adapter + webhook route (thin second implementation).
8. Tests throughout per the testing section.

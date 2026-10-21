# Talking to Sara: Voice Notes and Plain-English Requests — Design

**Date:** 2026-10-21
**Status:** Draft design, awaiting the owner's approval
**Depends on:** `2026-10-21-merchants-products-orders-customers-design.md` for the product,
order and customer actions the assistant uses. The read-only tools and the service and invoice
tools can be built first.

## Summary

Owners can ask Sara for things in plain English as well as through the numbered menu. They can:

- send a WhatsApp voice note or a typed sentence on WhatsApp
- type a sentence on Instagram
- hold to talk, or type, in a panel on the web dashboard.

Sara turns voice notes into text with OpenAI Whisper and works out the request with an OpenAI
model that has Sara's own actions as tools. It answers questions straight away. For anything
that changes data, it sends a summary and waits for the owner to tap **Send it**. Sara always
replies in text.

This changes how Sara is positioned. `PRODUCT.md` says Sara "is not AI and must never be
described as one". That rule, and the landing page copy, change as part of this work.

## Why

- The owner wants owners to create things and make requests by WhatsApp voice note, and on the
  web app as well. People between clients talk into WhatsApp more than they type.
- The numbered menu is reliable but slow for multi-item invoices. It also can't answer anything
  it wasn't built for, such as "who hasn't paid me this week?"
- The owner pointed at StandaraWeb's AI voice work as the reference. Its tools,
  confirm-before-write and safety patterns carry over. Its live WebRTC voice session does not
  (see "What we take from Standara").

## Decisions (settled during brainstorming)

"Owner" means the owner said it. "Approved" means the owner approved a proposal, mostly through
the mockups.

| Question | Decision | Source |
| --- | --- | --- |
| What can owners do this way? | Create resources and make requests, on WhatsApp by voice note and on the web app. | Owner |
| Language | Plain English. | Owner |
| Typed sentences | Work too, not just voice notes. On Instagram, typed only for now. | Approved |
| Numbered menu | Stays for people who like it. "menu" and "0" still work. | Approved |
| What Sara heard | For a voice note, the reply starts with what Sara heard, so a mishearing shows up straight away. | Approved |
| Questions | Answered straight away. | Approved |
| Check-first | Anything a customer will see or pay comes back as a summary with **Send it** and **Change something**. Nothing is created until the owner taps. "Change something" lets them say the fix in another voice note. | Approved |
| Unclear requests | Sara asks with a numbered choice (e.g. two customers called Tolu), the way the menu works. | Approved |
| Prices | Taken from the catalog unless the owner says a different price. The summary shows the price either way. | Approved |
| Reply format | Text, not voice notes: links and amounts are easier to read than to hear. | Approved |
| Scope | Anything the menu and dashboard can do, plus the product actions (record a sale, check or change stock, add a product). | Approved |
| Web app | **Hold to talk:** the same brain and replies as WhatsApp, in a dashboard panel. A live spoken conversation (Standara-style) was considered and not chosen. | Owner |
| Speech-to-text | OpenAI Whisper (`whisper-1`). | Owner |
| The model | An OpenAI model, as Standara uses. | Owner |
| MCP | Not an MCP server. "MCP" meant the AI using Sara's actions. | Approved |
| Positioning | The "not AI" rule in `PRODUCT.md` and the landing copy change. | Approved |

## Calls I made (not discussed; check these)

1. **The default model is `gpt-5.4-mini`**, the fast model Standara falls back to. It's set by an
   environment variable so it can change without code. Reasoning effort starts at `low`.
   - Price at the time of writing: $0.75 input, $0.075 cached input, $4.50 output per million
     tokens.
   - A typical request (about three model calls plus a 15-second voice note) costs under 1 US
     cent. A busy owner making 20 requests a day comes to about $5 a month.
   - `gpt-5.4-nano` is about four times cheaper; `gpt-5.4` is about three times dearer.
2. **Every action that changes something asks first**, not only the ones a customer sees, such
   as stock changes. Reads answer straight away.
3. **Code writes the summary the owner approves**, from the validated draft, not the model. What
   the owner approves is exactly what runs. The model writes the conversational text around it.
4. **Drafts expire after 24 hours** and are checked again when tapped (stock, invoice status,
   prices).
5. **Voice notes longer than 2 minutes are refused.** Audio is thrown away after transcription.
   The transcript is kept with the request.
6. **Cost guards:**
   - 100 assistant requests per business per day, configurable
   - a usage log with the estimated cost of each request
   - an off switch for everyone.
7. **In the middle of a menu flow**, typed replies stay with the menu, as today. A voice note
   leaves the flow and goes to the assistant.
8. **Follow-ups work for 30 minutes** ("make it three instead"). After that, or after "menu",
   Sara starts fresh.
9. **On Instagram**, which has no reply buttons in our setup, Sara asks the owner to reply
   "yes" to send. Typed "yes" or "send it" also works on WhatsApp.
10. **Settings stay web-only.** Hours, days off, Google Calendar and bank details aren't changed
    by the assistant.
11. **The web panel is its own conversation.** A draft made there is approved there.
12. **The tools call Sara's services directly** (`src/backend/services/*`), as the menu does
    through `intentDispatcher`. They don't call Sara's own HTTP API, and they aren't generated
    from OpenAPI.
13. **WhatsApp webhooks are acknowledged straight away** and the voice note is processed in
    the background with `after()` from `next/server`. Transcription plus model calls can take
    several seconds, and Meta retries slow webhooks. The existing `claimMessage` stops
    duplicates.
14. **A short progress message** ("One moment…") goes out through the existing `onProgress`
    hook when a reply takes more than about 4 seconds.
15. **On for every business**, with the daily limit and the off switch. There's no
    per-business opt-in.

## Goals

- "Invoice Tolu for two frontal wigs, forty-five thousand each, due Friday" returns a correct
  draft with Send it / Change something within about 10 seconds. One tap creates the invoice and
  returns its pay link.
- "Who hasn't paid me this week?" is answered in one reply.
- "Sold three bottles of shea butter to Amaka, paid cash" returns a draft. One tap creates the
  receipt and order and takes the stock.
- The web panel does the same with the same answers.
- Typed sentences work like voice notes.
- The numbered menu works exactly as before.
- Costs are capped per business and visible per request.

## Non-goals

- A live, spoken back-and-forth (Realtime API over WebRTC).
- Sara replying with voice notes.
- Voice notes on Instagram.
- Languages other than English, including Pidgin and Yoruba.
- An MCP server for ChatGPT or Claude.
- Any message to a customer on WhatsApp.
- Changing settings by voice.
- Creating products from photos sent in chat. Photos are added on the web.
- Sara starting conversations: reminders, nudges, proactive suggestions.
- Charging owners for AI use, or a usage screen for owners.

## Anti-goals (what would make this a failure even if it works)

- Anything created or changed without the owner seeing and approving the exact summary.
- One approval creating two invoices or sales, through a double tap, a re-delivered webhook or
  a retry.
- The model silently picking a customer, item or amount when more than one fits.
- Sara saying it did something it didn't, or quoting a number that no tool returned.
- An owner, or anyone holding a linked number, running up unlimited AI cost.
- The numbered menu breaking or disappearing.
- Replies slow enough that owners go back to the menu.

## Constraints

- **OpenAI only**, by the owner's choice: `whisper-1` for speech-to-text, and the Responses API
  with function tools for the rest, as Standara does (`lib/ai/transport/responses.ts`). Use the
  official `openai` npm package; Standara is on `^6.15.0`, so check the current major.
- **Environment variables**, added to `src/env.js` and `.env.example`:
  - `OPENAI_API_KEY`
  - `OPENAI_ASSISTANT_MODEL` (default `gpt-5.4-mini`)
  - `OPENAI_TRANSCRIBE_MODEL` (default `whisper-1`)
  - `ASSISTANT_ENABLED` (default on)
  - `ASSISTANT_DAILY_LIMIT` (default 100).
- **WhatsApp Cloud API:**
  - voice notes arrive as `audio` messages (OGG/Opus) that must be downloaded through the media
    endpoint with `WHATSAPP_TOKEN`
  - replies must fall within the 24-hour window, which they do, since Sara is replying
  - reply buttons are `interactive` messages: at most three buttons, titles up to 20 characters.
- **Money in chat replies** uses the chat's existing `formatMoney` ("NGN 45,000").
- **Numbers come from the services the dashboard uses** (`dashboardService` and the rest), so
  the chat, the panel and the dashboard always agree.
- **The web panel follows `DESIGN.md`** and the design rules in `CLAUDE.md`.

## How it works

### Routing an incoming message

`ConversationEngine.handle` keeps identity lookup, linking and `claimMessage` as they are, then
routes the message:

1. **A button tap or a typed "yes" / "send it" while a draft is pending** approves the draft.
   "Change something" asks "What should change?" and sends the next message to the assistant
   with the draft in context.
2. **"menu", "0" and "cancel"** behave as today. "cancel" also cancels a pending draft.
3. **On the main menu, a menu number** starts that menu flow, as today.
4. **Inside a menu flow, typed text** goes to that flow, as today.
5. **Everything else goes to the assistant:** any voice note, and any other typed text on the
   main menu. A greeting, or anything the assistant can't place, gets a one-line reply saying
   what Sara can do and that "menu" shows the numbered menu.

The channel types grow to carry these:

- **Inbound** messages gain a kind (text, voice or button) with a media id or a button id.
  WhatsApp's `normalizeInbound` stops dropping `audio` and `interactive` messages; today it keeps
  only `text` (`channels/whatsapp/index.ts:66`).
- **Outbound** messages can carry reply buttons.

Other message types, such as images and stickers, are still ignored.

### Turning a voice note into text

1. Fetch the media URL from the Graph API with the media id, then download it with the WhatsApp
   token.
2. Refuse anything over 2 minutes, by duration or a size cap, with a reply asking for a shorter
   voice note.
3. Send the file to OpenAI's transcription endpoint with `OPENAI_TRANSCRIBE_MODEL` and language
   `en`.
4. Throw the audio away.

The reply starts with what Sara heard: `🎙️ "<transcript>"`, cut to about 200 characters. If
transcription fails, Sara says: "Sorry, I couldn't make that out. Could you try again, or type
it?"

### The assistant turn

- One Responses API call with:
  - the system prompt and the tool list, unchanged across requests and placed first so OpenAI's
    automatic prompt caching applies
  - the business context: name, currency, today's date in Lagos time, and what the business
    sells
  - the recent conversation
  - the new message.
- The loop runs tool calls until the model answers, capped at about 6 rounds.
- The business always comes from the linked identity or the signed-in user, never from the
  model.
- Every id the model passes is checked against that business.
- Tool inputs are validated with zod, and unknown tools are rejected.
- Totals and prices are worked out in code. The model's numbers are never used for money unless
  the owner stated a price, and in that case it is shown in the summary.

### Tools (first version)

**Reads, answered straight away:**

- find customers
- get a customer: history, spent, owed
- list items: services and products, with options, prices and stock
- unpaid invoices: optionally for one customer or period
- bookings: for a day or range
- orders to send out
- business summary: today, this week or this month; revenue, unpaid, by item
- find a document: invoice, receipt or order by number
- share link: returns an item's link for the owner to forward. It changes nothing.

**Changes, drafted then approved:**

- create invoice: customer, lines, optional due date and notes
- create receipt: customer, lines or an amount, payment method, optional delivery. A receipt
  listing products is a recorded sale.
- record invoice payment
- void invoice
- update order: Ready, Completed or Cancelled
- adjust stock: add, remove or set
- create or update a product or service: price, pause
- booking actions: confirm, cancel, reschedule, mark done
- create or update a customer.

### Drafts and approvals

- A change tool doesn't change anything. It validates the input against current data and stores
  a **pending action**: business, channel or user, kind, validated payload, the code-written
  summary, status, `expiresAt` (24 hours).
- Sara sends the summary with the buttons. On WhatsApp these are interactive reply buttons whose
  ids carry the pending action id.
- **On approval:**
  1. Claim the action atomically (pending → done). A second tap, a retry or a re-delivered
     webhook sees "Already done" and changes nothing.
  2. Re-check the action against current data.
  3. Run the same service call the dashboard uses.
  4. Reply with the result and its link, e.g.
     `✅ INV-1042 created. Send Tolu this pay link: app.sara.ng/invoices/x7Kq2Lm9`.
- If the re-check fails (stock is gone, the invoice was paid in the meantime), Sara says what
  changed and offers a fresh draft.
- A new draft replaces any older pending draft in the same conversation.

### What the prompt must say

The builder writes the wording. The rules:

- Look things up before using them. Never make up an id, customer, item or number.
- When more than one thing fits, ask with a numbered list of the top 2–3. Never pick silently.
- Search before creating. Don't create a customer or item when one matches.
- Prices come from the catalog unless the owner states one.
- Never say something was created or changed: changes are drafts until the owner approves.
- Keep replies short and in WhatsApp formatting (`*bold*`, numbered lists). No tables or
  headings.
- Say plainly when something can't be done, and mention "menu".

Standara's prompt blocks are a useful starting point: `lib/ai/systemPrompts.ts` (resolve, don't
trust; search before write) and `lib/ai/voice/voiceSystemPrompt.ts` (disambiguation, error
recovery).

### Conversation memory

Follow-ups within 30 minutes see the recent turns: messages, tool calls and the current draft.
After 30 minutes, or after "menu", the next message starts fresh. The builder decides where turns
are stored: a new table, or OpenAI's `previous_response_id` chaining.

### Web panel

- A "Sara" button in the app chrome (`src/components/app-chrome.tsx`) opens the panel. It's a
  bottom sheet on phones and a side panel on wide screens.
- The panel has a text box and a **Hold to talk** button that records with `MediaRecorder`,
  using whatever the browser offers (webm/opus, or mp4 on iOS Safari; Whisper accepts both).
- It talks to authenticated endpoints:
  - send a message (audio or text), which returns what Sara heard, the reply and an optional
    draft
  - approve a draft
  - ask to change a draft.
- Drafts appear as a card with Send it and Change something buttons, the same summary text as
  WhatsApp.
- The mic only starts from a user gesture. If permission is refused, the panel says so and
  typing still works.

### Limits, logging and the off switch

- **When `ASSISTANT_ENABLED` is off**, voice notes get "I can't take voice notes right now —
  reply menu", and typed sentences fall back to the menu.
- **The daily limit is per business.** Past it, Sara says so and points to the menu.
- **The usage log** records, per request:
  - business, channel, voice or text, audio seconds
  - model, input, cached and output tokens, estimated cost
  - time taken
  - outcome: answered, draft, approved or error.

  There's no owner-facing screen; it's for Sara's team.
- **Timeouts:** a request that runs past about 25 seconds stops with "Something went wrong on my
  side. Try again, or reply menu."

## What we take from Standara, and what we don't

| Take | Standara source |
| --- | --- |
| A curated tool list with each tool marked read or write, and writes previewed and confirmed before they run | `lib/ai/mutationHandler.ts`, `app/api/ai/chat/confirm` |
| Run each approved action at most once | `app/api/ai/voice/relay/route.ts` (dedup on session + call id) |
| Prices from the catalog, not from what the model heard | `resolveProductSnapshot` in the relay |
| Prompt rules: resolve, don't trust; search before write; numbered choices; speak the error | `lib/ai/systemPrompts.ts`, `lib/ai/voice/voiceSystemPrompt.ts` |
| A global off switch | `lib/ai/voice/voiceGlobalKill.ts` |
| Per-request cost logging | `app/api/ai/voice/session/finalize/route.ts`, `lib/ai/pricing/estimateCost.ts` |
| The model set by an environment variable | `lib/ai/modelResolver/pickChatModel.ts` |

Not carried over: the Realtime session over WebRTC, ephemeral tokens, the browser-side tool relay,
the live draft pane, and the OpenAPI-generated tool catalog (`scripts/generate-tools.ts`). Sara's
tools are a short hand-written list over its own services.

## Positioning and copy

- **`PRODUCT.md`:**
  - remove "Sara is not AI and must never be described as one"
  - replace "Deterministic over clever" with a principle that keeps its point: Sara understands
    plain English, but it always shows exactly what it will do and waits for you
  - update Positioning, Operating Context (voice notes, the web panel), Capabilities, and the
    "Does NOT exist yet" list, including the merchant features from the companion spec.
- **The landing page** describes sending a voice note and selling products in the calm, warm
  voice of the brand.
  - Lead with what the owner does ("send Sara a voice note"). Keep "AI" out of headlines.
  - "Start on WhatsApp" stays the primary call to action.
  - Copy claims only what has shipped.

## Error handling

| Failure | Reply |
| --- | --- |
| Can't transcribe | "Sorry, I couldn't make that out. Could you try again, or type it?" |
| A tool rejects its input (e.g. no such product) | The model gets the error and asks the owner, e.g. "There's no product called X. Did you mean Y?" |
| A draft fails its re-check when tapped | Say what changed and offer a fresh draft |
| An OpenAI error, or a timeout | "Something went wrong on my side. Try again, or reply menu." |
| Over the daily limit or switched off | Say so and point to the menu |

## Testing

- **Unit tests:**
  - routing rules
  - parsing WhatsApp `audio` and `interactive` messages
  - approving a pending action twice
  - re-checks on approval
  - tool input validation and the business check on ids
  - the limit and the off switch
  - transcription failure and the over-length refusal.
- **Service-level tests** for each tool, in the existing vitest style.
- **A small evaluation set** of about 30 real-world requests written as text, each with the
  expected draft or answer. It runs against the live model before release and when the model or
  prompt changes; each run costs a few cents.

## Implementation sequencing

1. WhatsApp inbound: `audio` and `interactive` parsing, media download, Whisper, the background
   processing with `after()`.
2. The assistant with the read tools, routing, and the "what Sara heard" replies.
3. Drafts and approvals for the change tools, buttons, expiry and re-checks.
4. Limits, usage log, off switch.
5. Instagram typed sentences.
6. The web hold-to-talk panel.
7. `PRODUCT.md` and the landing copy.

## Owner to-do outside the code

- Create the OpenAI API key and set a monthly spending limit on the OpenAI account, as a second
  guard behind the daily limit.
- Sara has no privacy page today. Voice notes, messages and customers' names, phones and emails
  will now go to OpenAI to be processed. Decide whether owners need a privacy notice before
  launch (Nigeria's Data Protection Act applies).

## Left to the builder

- Prompt wording.
- Tool names and schemas.
- Where conversation turns are stored.
- How audio length is measured.
- The OpenAI SDK version and caching details.
- The panel's components and layout within `DESIGN.md`.
- The evaluation harness format.

## Mockups

The owner approved this during brainstorming, choosing option A for the web app. It's stored
locally and not committed: `.superpowers/brainstorm/1722-1792596598/content/talking-to-sara.html`
(the WhatsApp voice-note threads and the web "hold to talk" panel).

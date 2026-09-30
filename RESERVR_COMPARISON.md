# Sara vs. Reservr (getreservr.app)

A comparison between this project (Sara) and [Reservr](https://getreservr.app/), a pre-launch booking/scheduling SaaS for solo service providers, plus a shortlist of Reservr features worth borrowing.

## What Reservr is

Reservr is a consumer-facing booking tool aimed at individual service providers (hair/makeup, photographers, therapists, coaches, tattoo artists, consultants, etc.) who currently take bookings over WhatsApp/Instagram DM. Its pitch: a single shareable link (`getreservr.app/studiobymaya`) that replaces DM-based scheduling with 24/7 self-serve booking, gated by an upfront deposit to kill no-shows. Still pre-launch/waitlist (247 signups at time of writing), free during beta.

Core features it advertises:
- Permanent shareable booking link + QR code (bio link, WhatsApp status, in-store scan)
- Deposit-gated booking ("No deposit. No booking.") via Paystack/Stripe/Flutterwave
- Google Calendar + native phone calendar sync, with automatic buffer time between appointments
- Holiday / rest-day blocking
- Client reliability scoring: **Reliable / Watch / Flagged**, based on no-show history, surfaced before confirming a new booking
- Analytics dashboard: total bookings, deposit revenue, week-over-week deltas, no-show rate, trend graphs

## What Sara is

Sara is an API-first (headless) backend for service businesses, currently built around:

| Area | Sara |
|---|---|
| Booking core | `Business` → `Service` → `Booking` model with slug-based public pages, status lifecycle (`PENDING/CONFIRMED/COMPLETED/CANCELLED`) |
| Availability | Computed from weekly `BusinessHours`, one-off `BusinessClosure`s, existing bookings, and (if connected) the owner's Google Calendar busy times — `src/backend/services/availability` |
| Calendar sync | Two-way Google Calendar integration: confirmed bookings create events, cancellations remove them, reschedules move them, busy time excludes availability — `src/backend/services/googleCalendar` |
| Notifications | Booking confirmation/cancellation/reschedule + 24h-ahead reminder emails via Resend, dispatched by a cron-hit endpoint (`/api/cron/booking-reminders`) |
| Payments | Stripe + Paystack (with subaccount/webhook support) + Mono (Nigerian open-banking account linking for settlement) — `src/backend/services/{paystack,mono}` |
| Billing docs | Full `Invoice`/`Receipt` models with line items, tax, discount, partial payment status (`PARTIALLY_PAID`), PDF generation (`src/backend/services/pdf`) |
| Owner chat assistant | A WhatsApp + Instagram conversational bot **for the business owner** (not the client) — create invoices/receipts, share a service's booking link, check unpaid invoices, see today's bookings, get a business summary, all via chat menu states — `src/backend/services/messaging/*` (current branch: `feat/whatsapp-instagram-gateway`) |
| Location/routing | "Atlas" geocoding, reverse-geocoding, address search, and OSM route/polyline calculation between client and business — for on-location/mobile services — `src/backend/services/atlas` |
| Revenue overview | Per-service revenue + booking count aggregation with date-range filtering (`/api/overview`) |
| Media | Gallery items via Cloudinary |
| Auth | NextAuth with Google, Facebook, Instagram OAuth |
| API surface | OpenAPI-documented REST API (`next-openapi-gen`, Swagger UI) — no end-user dashboard UI yet, beyond a `mono` account-linking page and Atlas map components |

## How similar are they?

**Same core problem, same shape of solution.** Both are built around: a business with services → a slug-addressable public booking surface → availability that respects working hours/closures/existing bookings → calendar sync → payment collection → post-booking documents/notifications. The data model Sara has independently converged on (`Business`, `Service`, `Booking`, working hours, closures, Google Calendar sync) is essentially a superset of Reservr's advertised booking core.

**Where they diverge:**
- **Audience framing.** Reservr is a polished, marketing-driven consumer SaaS for solo creators/freelancers. Sara currently has no client-facing marketing site or dashboard UI — it's a backend platform (the frontend/dashboard is presumably being built separately or is out of scope so far).
- **Financial sophistication.** Sara already has real invoicing/receipts with tax, discount, and partial-payment tracking — more than Reservr appears to expose (Reservr talks about "deposits," not full invoicing).
- **Owner tooling channel.** Sara's WhatsApp/Instagram integration lets the *owner* manage the business from chat (invoices, receipts, daily bookings) — an angle Reservr doesn't mention at all; Reservr's WhatsApp mention is purely "this is the old, manual way we replace."
- **Geo/routing.** Sara's Atlas service (geocoding, distance, route polylines) has no Reservr equivalent — useful for mobile/at-home service providers, which Reservr doesn't address.
- **Anti-no-show mechanics.** Reservr's headline feature — mandatory deposit at booking time gating confirmation, plus a client reliability score (Reliable/Watch/Flagged) — has no counterpart in Sara today. Sara's `Payment`/`Invoice` models could support a deposit *after the fact*, but nothing currently blocks a booking from confirming without payment.
- **Scheduling polish.** Reservr explicitly advertises automatic buffer time between appointments and holiday/rest-day blocking as first-class settings; Sara has closures (arbitrary date-based) but no buffer-time concept between consecutive bookings.

## Features worth incorporating into Sara

Roughly in order of leverage vs. effort:

1. **Deposit-gated bookings.** Let a `Service` define a required deposit (flat or %), and hold a `Booking` in `PENDING` until a `Payment` covering the deposit lands — mirrors Reservr's core no-show defense and slots naturally into Sara's existing `Payment`/`Invoice` models.
2. **Client reliability signal.** Derive a Reliable/Watch/Flagged-style status per client (by phone/email) from historical no-show/cancellation rate on past `Booking`s, surfaced when a new booking for that client comes in — pure read-model work over existing data, no schema migration required beyond an index.
3. **Buffer time between bookings.** Add a per-service or per-business buffer (minutes) that the availability engine (`src/backend/services/availability`) subtracts around existing bookings when computing free slots.
4. **No-show / cancellation analytics.** Extend `/api/overview` with no-show rate and week-over-week deltas, complementing the revenue numbers already computed there.
5. **Shareable booking link + QR code.** Sara already has slug-based public service pages (`/api/public/services/[slug]`); generating a QR code for that URL and exposing it via the owner chat bot ("share a service") or a future dashboard is a small addition with outsized shareability value.
6. **Client-facing WhatsApp booking (not just owner tooling).** Reservr's whole growth loop assumes clients book where they already are (DMs, bio links). Sara's messaging engine currently only serves the *owner*; extending the same channel infrastructure (`src/backend/services/messaging/channels`) to let a *client* browse services and book directly in WhatsApp/Instagram would combine Sara's existing chat plumbing with Reservr's core UX bet — arguably a stronger differentiator than either product alone.
7. **Rest-day/holiday quick-toggle.** Reservr frames closures as a simple on/off holiday switch; Sara's `BusinessClosure` already models this — mostly a UX/dashboard exposure gap, not a backend one.

## Caveats

This assessment is based on Reservr's public marketing site only (pre-launch, waitlist-stage) — there's no access to its actual product, API, or admin dashboard, so some claimed features (e.g. calendar sync details, exact deposit mechanics) are taken at face value from copy and screenshots rather than verified behavior.

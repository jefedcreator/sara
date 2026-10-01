# Nightly & Daily Booking (Shortlets and Car Hire) — Design

**Date:** 2026-10-01
**Status:** Approved design, pending implementation plan

## Summary

Sara's booking engine only sells fixed-length time slots inside a single day, and every
booking blocks the whole business. That fits a one-chair studio but not a shortlet host
(stays cross midnight, guests choose how many nights, apartments are booked independently)
or a self-drive car hire operator (rentals run for days from a chosen pickup time, cars are
booked independently).

This design adds a **booking mode** to each service — `SLOT` (today's behaviour), `NIGHTLY`
(shortlets) and `DAILY` (self-drive) — with variable length priced as `price × units`, a
**per-service calendar** for nightly and daily services, and **expiring payment holds** so
abandoned checkouts stop blocking time. The customer page stays at `/book/<service-slug>`
and adapts to the mode.

This is sub-project 1 of 4 for the shortlet / car hire market:

1. **Booking engine** (this spec).
2. Caution fees / security deposits: collect and track refund status.
3. Channel sync: iCal import/export with Airbnb and Booking.com.
4. Rental details (guest count, ID / driver's licence, pickup and drop-off points), then
   the homepage copy rewrite for beauty, shortlets and car hire.

## Decisions (settled during brainstorming)

| Question | Decision |
| --- | --- |
| Separate marketing pages per trade? | No. One homepage; the customer booking page adapts per service. |
| Copy before or after the engine? | Engine first. Copy may only claim what exists (`PRODUCT.md`). |
| Several apartments / cars | Each unit is its own service, link and calendar. "N identical units" later if fleets ask. |
| Shortlet model | Hotel model: fixed check-in / check-out times per service; guest picks dates; priced per night; same-day turnover allowed. |
| Car hire model | Self-drive: 24-hour days from a chosen pickup time, priced per day. Chauffeur hire within a day stays a `SLOT` service. |
| Architecture | A `bookingMode` on `Service`; one booking/invoice/payment/receipt pipeline; mode-specific availability and pricing (Approach 1). |

## Goals

- A host shares one link per apartment; the guest picks check-in and check-out dates, sees
  "3 nights × NGN 85,000 = NGN 255,000" and pays.
- An operator shares one link per car; the customer picks the number of days, a pickup day
  and time, and pays `price × days`.
- Bookings for one apartment or car never block another unit or the owner's appointments.
- Two customers can never both pay for overlapping time on the same unit.
- An abandoned checkout stops blocking time after 30 minutes, in every mode.
- Every existing `SLOT` service behaves exactly as before (apart from hold expiry).

## Non-goals

- Caution fees, deposits and refunds (sub-project 2).
- iCal / Airbnb / Booking.com sync (sub-project 3).
- Guest count, ID or licence capture, pickup and drop-off locations (sub-project 4).
- Weekend, seasonal or weekly rates; discounts on long stays.
- Inventory of identical units ("Toyota Corolla × 3").
- Changing the length of an existing stay or rental (cancel and rebook, or invoice the
  difference).
- Per-unit blocked dates for maintenance (the owner books the unit under their own name).

## Data model

```prisma
enum BookingMode {
  SLOT
  NIGHTLY
  DAILY
}

model Service {
  // ...existing fields
  bookingMode  BookingMode @default(SLOT)
  checkInTime  String?     // NIGHTLY only, "HH:mm", e.g. "14:00"
  checkOutTime String?     // NIGHTLY only, "HH:mm", e.g. "12:00"
  minUnits     Int         @default(1)  // min nights (NIGHTLY) or days (DAILY); ignored for SLOT
  maxUnits     Int         @default(30) // max nights or days, capped at 90; ignored for SLOT
}

model Booking {
  // ...existing fields
  units         Int       @default(1) // nights or days; 1 for SLOT
  amount        Decimal   @db.Decimal(10, 2) // price × units at booking time
  holdExpiresAt DateTime? // a PENDING booking stops blocking after this

  @@index([serviceId, startTime, endTime])
}
```

Field meaning by mode:

| Field | SLOT | NIGHTLY | DAILY |
| --- | --- | --- | --- |
| `price` | per booking | per night | per day |
| `duration` | slot length (minutes) | fixed at 1440, unused | fixed at 1440, unused |
| `availableFrom` / `availableTo` | slot window | unused | hours a pickup may start |
| `checkInTime` / `checkOutTime` | null | required | null |
| `minUnits` / `maxUnits` | ignored (units forced to 1) | nights | days |

`duration` keeps a value for non-slot modes so existing readers do not break; nothing new
reads it for those modes.

### Migration

One Prisma migration:

1. Create `BookingMode`; add the `Service` columns with the defaults above. Every existing
   service becomes `SLOT` with no behaviour change.
2. Add `Booking.units` (default 1) and `Booking.holdExpiresAt` (nullable).
3. Add `Booking.amount` as nullable, backfill
   `UPDATE "Booking" b SET amount = s.price FROM "Service" s WHERE b."serviceId" = s.id`,
   then set `NOT NULL`.
4. Backfill `holdExpiresAt = "createdAt" + interval '30 minutes'` for `PENDING` bookings,
   so stale unpaid holds stop blocking at once.
5. Add the `(serviceId, startTime, endTime)` index.

## Shared rules (pure modules)

### Booking terms — `backend/services/booking/terms.ts`

`bookingTerms(service, startTime, units) → { endTime, units, amount }` or a
`BadRequestException` with a customer-readable message. The client never sends `endTime`
or a price for `NIGHTLY`/`DAILY`; the server derives both.

| Mode | Input | `endTime` | `amount` |
| --- | --- | --- | --- |
| SLOT | `startTime` (units forced to 1) | `startTime + duration` | `price` |
| NIGHTLY | `startTime` = check-in date at `checkInTime`, `units` = nights | (check-in date + units) at `checkOutTime` | `price × units` |
| DAILY | `startTime` = pickup, `units` = days | `startTime + units × 24h` | `price × units` |

Validation in the same function: `minUnits ≤ units ≤ maxUnits`; `NIGHTLY` start time must
equal `checkInTime`; `DAILY` start must fall on a whole hour; start not in the past
(judged against Lagos wall-clock now, following the existing wall-clock-in-UTC
convention); start no more than 180 days ahead. Money uses Prisma `Decimal`, converted to
kobo only when charging Paystack.

### Conflict scope — `backend/services/booking/conflicts.ts`

`blockingBookingsWhere(service, range, now, excludeId?) → Prisma.BookingWhereInput`, used
by availability, booking creation and owner reschedules so the three never disagree.

- A booking blocks only if `status = CONFIRMED`, or `status = PENDING` and
  (`holdExpiresAt` is null or `holdExpiresAt > now`). New `PENDING` bookings always set
  `holdExpiresAt = createdAt + 30 min`.
- `SLOT` services: blocked by other `SLOT` bookings anywhere in the business (the owner's
  own time), as today.
- `NIGHTLY` / `DAILY` services: blocked only by bookings of the **same service**.
- A `SLOT` booking never blocks a unit; a unit booking never blocks a slot.
- Overlap is the existing half-open test: `startTime < range.end AND endTime > range.start`.

## Availability

`availability/index.ts` becomes a dispatcher over `slot.ts`, `nightly.ts` and `daily.ts`.

### SLOT (`slot.ts`)

Today's logic, moved unchanged except that existing-booking overlap uses
`blockingBookingsWhere`. Business hours, closures and Google Calendar busy time still
apply.

### NIGHTLY (`nightly.ts`)

`getNights({ serviceId, from, to }) → { date, isAvailable }[]` for each night in
`[from, to)` (one month per request). Night `d` is the range
`[d at checkInTime, d+1 at checkOutTime)`; it is unavailable if a blocking booking overlaps
it or `d` is before today. Because `checkOutTime ≤ checkInTime`, a check-in on another
guest's check-out day does not overlap. Business hours, closures and Google Calendar busy
time do **not** apply (self check-in is common; a guest staying over a holiday is fine).

A stay is bookable when every night in it is available and `bookingTerms` accepts it; the
booking page enforces this, and booking creation re-checks it.

### DAILY (`daily.ts`)

`getPickupTimes({ serviceId, date, units }) → { startTime, endTime, isAvailable }[]` for
whole hours from `availableFrom` up to and including the last hour before `availableTo`.
A pickup time is available when:

1. it is within business hours on a non-closure day;
2. the return time (`start + units × 24h`) is within business hours on a non-closure day;
3. no blocking booking for the same service overlaps `[start, return)`;
4. it is in the future and within the 180-day horizon.

Google Calendar busy time does not apply.

## Booking creation

`bookingService.createWithPayment` takes `{ serviceSlug | serviceId, startTime, units?,
endTime? }`. `endTime` is accepted only for `SLOT` (the current client keeps working);
`units` is required for `NIGHTLY`/`DAILY` and ignored for `SLOT`.

1. Load the service; existing checks (active, Paystack subaccount).
2. `bookingTerms` → `endTime`, `units`, `amount`. For `SLOT`, a supplied `endTime` must match.
3. In one `Serializable` transaction: query `blockingBookingsWhere`; if any, throw
   `ConflictException` (409) — "Those dates were just taken. Pick different dates." for
   unit modes, the existing slot message for `SLOT`; otherwise insert the `PENDING`
   booking with `units`, `amount` and `holdExpiresAt = now + 30 min`. On a serialization
   failure, retry once, then return the same 409.
4. Initialise Paystack with `amount` (kobo) and add `units` to the metadata.

`POST /api/public/bookings` schema: `startTime` required; `units` optional positive int;
`endTime` optional. Route returns 409 for conflicts (the page refetches availability).

## Payment webhook

`handleChargeSuccess` changes:

- Receipt line: `quantity = units`, `unitPrice = service.price`, `total = amount`
  (e.g. "Lekki 2-bed 4B · 3 × NGN 85,000").
- **Late payment for an expired hold:** if the booking is `PENDING` and `holdExpiresAt`
  has passed, re-run the conflict check excluding this booking. If still free, confirm as
  normal. If taken, record the `Payment`, set the booking `CANCELLED`, send the customer
  the cancellation email, and notify the owner in chat: "Payment of NGN 255,000 from Bisi
  Ojo came in for Lekki 2-bed 4B, 2–5 Oct, but those dates were already booked. Refund it
  from your Paystack dashboard." No receipt is created.

## Owner reschedule

`PUT /api/bookings/[slug]` (dashboard and chat) uses `bookingTerms` with the booking's
existing `units` and `blockingBookingsWhere(..., excludeId)`. Moving a stay or rental keeps
its length, so the paid amount stays correct. For unit modes the client sends only
`startTime`.

## Display helpers — `utils/format.ts`

One source of wording for every surface:

- `serviceLabel(service)`:
  - SLOT: "Knotless braids — NGN 25,000 (4 hr)" (unchanged)
  - NIGHTLY: "Lekki 2-bed, Unit 4B — NGN 85,000 / night"
  - DAILY: "Toyota Prado, LND-482-KJ — NGN 70,000 / day"
- `bookingWhen(booking, service)`:
  - SLOT: "Mon 28 Sep, 13:00" (today's `formatSlotMoment`)
  - NIGHTLY: "Check-in Fri 2 Oct from 14:00 · Check-out Mon 5 Oct by 12:00 · 3 nights"
  - DAILY: "Pickup Mon 28 Sep, 10:00 · Return Wed 30 Sep, 10:00 · 2 days"
- `bookingSpan(booking)` for compact lists: "2–5 Oct · 3 nights", "28–30 Sep · 2 days".

The chat's own `(${duration} min)` label in `messaging/dispatch` is replaced by
`serviceLabel`.

## Surfaces

### Customer booking page (`/book/[slug]`)

`PublicService` gains `bookingMode`, `checkInTime`, `checkOutTime`, `minUnits`,
`maxUnits`. `GET /api/public/services/[slug]` accepts, by mode: `date` (SLOT, as today);
`from` + `to` (NIGHTLY, max 62 days apart); `date` + `units` (DAILY). It returns `slots`
(SLOT/DAILY) or `nights` (NIGHTLY).

`BookingPageClient` keeps the service column and the pinned pay bar and swaps the picker
panel by mode:

- **SLOT:** unchanged (day strip, slot grid).
- **NIGHTLY:** `StayCalendar`, a month grid (7 columns, prev/next month). Tap check-in,
  then check-out; nights in between highlight; unavailable nights use the existing "taken"
  style; a range crossing a taken night is rejected with "Some nights in those dates are
  booked." Pills: price "/ night", "Check-in from 14:00", "Check-out by 12:00". Summary:
  "Fri 2 Oct → Mon 5 Oct · 3 nights · NGN 255,000". Button: "Pay NGN 255,000 with
  Paystack".
- **DAILY:** `DayCountStepper` ("How many days?", min–max), then the day strip (pickup
  day, 60 days ahead) and the slot grid (pickup times). Summary: "Pickup Mon 28 Sep, 10:00
  → Return Wed 30 Sep, 10:00 · 2 days · NGN 140,000".
- Details modal and the done page take their "when" text from `bookingWhen`.

All styling follows `DESIGN.md` with Tailwind tokens; 375px is the primary canvas.

### Owner service form (dashboard)

First field: **"How do customers book this?"** — *By time slot* / *By the night* / *By the
day*. Fields shown per mode:

- By time slot: price, duration, booking window (as today).
- By the night: price per night, check-in time, check-out time, minimum and maximum nights.
- By the day: price per day, pickup hours (`availableFrom`/`availableTo`), minimum and
  maximum days.

`serviceValidatorSchema` becomes mode-aware: `NIGHTLY` requires both times and
`checkOutTime ≤ checkInTime`; `minUnits ≤ maxUnits ≤ 90`; `SLOT` forces units to 1;
non-slot modes set `duration = 1440`. Changing `bookingMode` is rejected while the service
has upcoming `PENDING`/`CONFIRMED` bookings.

### Chat

- **3 Share a service:** options use `serviceLabel`.
- **5 Today's bookings:** `dashboardService.todayBookings` returns bookings that start
  **or** end today, each tagged with an event kind; the chat and dashboard render:

  ```
  12:00 Check-out · Ada Okafor · Lekki 2-bed 4B
  14:00 Check-in  · Bisi Ojo · Lekki 2-bed 4B (3 nights)
  10:00 Pickup    · Chidi Eze · Toyota Prado (2 days)
  13:00           · Funke Bello · Knotless braids
  ```

  sorted by time. Slot bookings render as today.
- **New booking notification** to the owner uses `bookingWhen`.
- Menu items 1, 2, 4 and 6 are unchanged (revenue counts payments, not modes).

### Dashboard bookings list

Unit-mode bookings show `bookingSpan` in place of a single time; reschedule for them picks
a new start date (and pickup time for DAILY) with the length fixed.

### Emails and Google Calendar

Confirmation, reminder, reschedule and cancellation emails replace the "when" and
"duration" rows with `bookingWhen`. The 24-hour reminder still fires 24 hours before
`startTime` (check-in or pickup). Calendar events keep `start`/`end` date-times (they span
the whole stay or rental) with the summary "Lekki 2-bed 4B — Bisi Ojo (3 nights)".

## Error handling

| Case | Response |
| --- | --- |
| Units outside min/max | 400 "Book between 2 and 30 nights." (wording per mode) |
| NIGHTLY start not at check-in time | 400 "Check-in is from 14:00." |
| DAILY return outside hours / on a day off | 400 "The car can't be returned on Thu 1 Oct. Pick different dates." |
| Overlap at create or reschedule | 409, page refetches and keeps the picked range |
| Start in the past / beyond 180 days | 400 |
| Mode change with upcoming bookings | 400 "Finish or cancel the upcoming bookings first." |
| Late payment, dates taken | booking cancelled, owner told to refund (see webhook) |

## Testing

Vitest, test-first, using the repo's existing mocked-`db` pattern.

- **Pure units:** `bookingTerms` per mode (end time, amount, min/max, past, horizon,
  check-in time); `blockingBookingsWhere` (same vs other service, SLOT business-wide,
  hold active vs expired, `excludeId`); format helpers.
- **Availability:** nightly (turnover-day check-in, taken mid-range night, past nights);
  daily (return outside hours, closure on return day, overlap with same car only); slot
  (unchanged results, expired holds ignored).
- **Booking service / routes:** each mode charges `price × units`; 409 on overlap;
  serialization retry; public route parameter validation (`from`/`to`/`units`).
- **Webhook:** receipt quantity and total; late payment confirmed when free; late payment
  cancelled and owner notified when taken.
- **Chat / dashboard:** today's bookings lists check-ins, check-outs, pickups and returns.
- **Manual:** run the app and book once per mode at 375px.

## Implementation sequencing

1. Schema + migration.
2. `bookingTerms` and `blockingBookingsWhere`.
3. Availability split (slot, nightly, daily) and public service endpoint.
4. Booking creation, public booking route, owner reschedule.
5. Webhook, display helpers, emails, chat, dashboard today, Google Calendar.
6. Owner service form and validator.
7. Customer booking page (`StayCalendar`, `DayCountStepper`).

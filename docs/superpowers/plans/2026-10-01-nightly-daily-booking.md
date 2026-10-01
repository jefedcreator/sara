# Nightly & Daily Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a service be booked by the night (shortlets) or by the day (self-drive cars) with variable length, per-unit calendars and expiring payment holds, while slot services keep working exactly as before.

**Architecture:** A `bookingMode` (`SLOT` | `NIGHTLY` | `DAILY`) on `Service`. Two pure modules decide everything mode-specific on the server: `bookingTerms` (end time + amount from start and units) and `blockingBookingsWhere` (which bookings block which). Availability splits into one module per mode behind the existing `availabilityService`. One booking → payment → receipt pipeline serves every mode; the customer page at `/book/<slug>` swaps its picker by mode.

**Tech Stack:** Next.js 15 App Router, Prisma 6 (PostgreSQL), Zod 4, TanStack Query, Tailwind v4 tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-nightly-daily-booking-design.md`

## Global Constraints

- Every existing service becomes `SLOT` and must behave as today, apart from holds expiring after 30 minutes.
- Booking times are wall-clock times written in UTC (a 14:00 check-in is stored as `14:00Z`). "Now" for past checks is Lagos wall-clock: `wallClockNow()` = real now + 1 hour. Hold expiry (`holdExpiresAt`) is a real instant, compared with real `new Date()`.
- `units`: nights (NIGHTLY), days (DAILY), always 1 for SLOT. `maxUnits` ≤ 90. Bookings at most 180 days ahead.
- `amount` = `price × units`, Prisma `Decimal`; converted to kobo only when charging Paystack (`Math.round(amount × 100)`).
- The client never sends a price, and never sends `endTime` for NIGHTLY/DAILY.
- Overlaps are half-open: `startTime < end AND endTime > start`.
- UI: Tailwind utilities on `src/styles/globals.css` tokens only, composed with `cn()`; no hard-coded colours, no inline `style` for design values; 375px first (`DESIGN.md`).
- Money in UI chrome: `formatMoney` → "NGN 85,000".
- Commit messages: no "Co-Authored-By: Claude" or any Claude/Claude Code attribution (CLAUDE.md).
- `docs/` is git-ignored; add plan/spec files with `git add -f`.
- Run tests with `yarn test <path>` (Vitest), types with `yarn typecheck`, lint with `yarn lint`.

## Review Focus

1. **A guest booking tonight after the check-in hour** (e.g. 18:00 for a 14:00 check-in) must succeed: NIGHTLY "in the past" compares dates, not times. Pinned in Task 3 and Task 5.
2. **Same-day turnover**: checking in on the day another guest checks out must be allowed in availability and at booking. Pinned in Task 5 (nightly test); booking creation uses the same half-open overlap through `blockingBookingsWhere` (Task 4), and Task 12's manual check books a turnover.
3. **An abandoned checkout** must stop blocking after 30 minutes in every mode, including slots. Pinned in Task 4 and Task 6.
4. **Picking check-in in one month and check-out in the next** must validate against both months' nights. Pinned in Task 12 (the anchor query) and by the 125-day window in Task 8.
5. **A payment that lands after its hold expired and the dates were resold** must not double-book: the booking is cancelled and the owner told to refund. Pinned in Task 9.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261001120000_add_booking_modes/migration.sql`
- Modify: `src/backend/services/booking/index.ts` (keep typecheck green: `amount` becomes required)

**Interfaces:**
- Produces: Prisma enum `BookingMode`; `Service.bookingMode | checkInTime | checkOutTime | minUnits | maxUnits`; `Booking.units | amount | holdExpiresAt`.

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`, add after `enum BookingStatus { … }`:

```prisma
enum BookingMode {
  SLOT
  NIGHTLY
  DAILY
}
```

In `model Service`, after `isActive    Boolean  @default(true)` add:

```prisma
  bookingMode  BookingMode @default(SLOT)
  checkInTime  String? // NIGHTLY only, "HH:mm"
  checkOutTime String? // NIGHTLY only, "HH:mm"; never later than checkInTime
  minUnits     Int         @default(1) // min nights (NIGHTLY) or days (DAILY); ignored for SLOT
  maxUnits     Int         @default(30) // max nights or days, at most 90; ignored for SLOT
```

In `model Booking`, after `notes      String?` add:

```prisma
  units         Int       @default(1) // nights (NIGHTLY) or days (DAILY); 1 for SLOT
  amount        Decimal   @db.Decimal(10, 2) // price × units when booked; what Paystack charges
  holdExpiresAt DateTime? // a PENDING booking stops blocking time after this
```

and add to Booking's index list:

```prisma
  @@index([serviceId, startTime, endTime])
```

- [ ] **Step 2: Write the migration**

`prisma/migrations/20261001120000_add_booking_modes/migration.sql`:

```sql
-- Booking modes: slot (today), nightly (shortlets), daily (self-drive).
CREATE TYPE "BookingMode" AS ENUM ('SLOT', 'NIGHTLY', 'DAILY');

ALTER TABLE "Service"
  ADD COLUMN "bookingMode" "BookingMode" NOT NULL DEFAULT 'SLOT',
  ADD COLUMN "checkInTime" TEXT,
  ADD COLUMN "checkOutTime" TEXT,
  ADD COLUMN "minUnits" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "maxUnits" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "Booking"
  ADD COLUMN "units" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "amount" DECIMAL(10,2),
  ADD COLUMN "holdExpiresAt" TIMESTAMP(3);

-- Every existing booking was one unit at the service's price.
UPDATE "Booking" b SET "amount" = s."price" FROM "Service" s WHERE b."serviceId" = s."id";
ALTER TABLE "Booking" ALTER COLUMN "amount" SET NOT NULL;

-- Unpaid bookings get the same 30-minute hold new ones get, so stale ones stop blocking now.
UPDATE "Booking" SET "holdExpiresAt" = "createdAt" + INTERVAL '30 minutes' WHERE "status" = 'PENDING';

CREATE INDEX "Booking_serviceId_startTime_endTime_idx" ON "Booking"("serviceId", "startTime", "endTime");
```

- [ ] **Step 3: Apply it and check the schema matches**

Start Postgres if it isn't running (`yarn docker:up` or `./start-database.sh`), then:

```bash
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
npx prisma generate
```

Expected: deploy applies `20261001120000_add_booking_modes`; diff prints `-- This is an empty migration.`

- [ ] **Step 4: Keep booking creation compiling**

In `src/backend/services/booking/index.ts`, inside `const data: Prisma.BookingCreateInput = { … }`, add after `notes: input.notes ?? null,`:

```ts
        amount: service.price,
```

(Task 6 replaces this whole function.)

- [ ] **Step 5: Verify**

Run: `yarn typecheck && yarn test`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261001120000_add_booking_modes src/backend/services/booking/index.ts
git commit -m "feat: booking modes, units, amount and payment holds in the schema"
```

---

### Task 2: Display helpers

**Files:**
- Modify: `src/utils/format.ts`
- Test: `src/utils/format.test.ts` (create)

**Interfaces:**
- Produces (all pure, client-safe):
  - `type BookingTimes = { bookingMode: BookingMode; startTime: string; endTime: string; units: number }`
  - `unitNoun(mode: BookingMode, n: number): string` → "night" | "nights" | "day" | "days"
  - `unitCount(mode: BookingMode, n: number): string` → "3 nights"
  - `serviceLabel(service: { name; price; duration; currency; bookingMode?: BookingMode }): string`
  - `bookingWhen(b: BookingTimes): string`
  - `bookingSpan(b: BookingTimes): string`
  - `todayEventLabel(kind: TodayEventKind): string`, `type TodayEventKind = "SLOT" | "CHECK_IN" | "CHECK_OUT" | "PICKUP" | "RETURN"`
  - `eachDate(from: string, to: string): string[]` (dates in `[from, to)`)
  - `daysBetween(from: string, to: string): number`
  - `monthStart(isoDate: string): string`, `addMonths(month: string, n: number): string`, `formatMonth(month: string): string`
  - `nightsWindow(month: string, maxUnits: number): { from: string; to: string }`

- [ ] **Step 1: Write the failing tests**

`src/utils/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  addMonths,
  bookingSpan,
  bookingWhen,
  daysBetween,
  eachDate,
  formatMonth,
  monthStart,
  nightsWindow,
  serviceLabel,
  todayEventLabel,
  unitCount,
} from "./format";

describe("unit wording", () => {
  it("counts nights and days", () => {
    expect(unitCount("NIGHTLY", 1)).toBe("1 night");
    expect(unitCount("NIGHTLY", 3)).toBe("3 nights");
    expect(unitCount("DAILY", 2)).toBe("2 days");
  });
});

describe("serviceLabel", () => {
  const base = { name: "Lekki 2-bed, Unit 4B", price: "85000", duration: 1440, currency: "NGN" };
  it("keeps the slot label", () => {
    expect(serviceLabel({ name: "Knotless braids", price: 25000, duration: 240, currency: "NGN" })).toBe(
      "Knotless braids — NGN 25,000 (4 hr)",
    );
  });
  it("prices stays per night and rentals per day", () => {
    expect(serviceLabel({ ...base, bookingMode: "NIGHTLY" })).toBe("Lekki 2-bed, Unit 4B — NGN 85,000 / night");
    expect(serviceLabel({ ...base, name: "Toyota Prado", price: 70000, bookingMode: "DAILY" })).toBe(
      "Toyota Prado — NGN 70,000 / day",
    );
  });
});

describe("bookingWhen and bookingSpan", () => {
  const stay = {
    bookingMode: "NIGHTLY" as const,
    startTime: "2026-10-02T14:00:00.000Z",
    endTime: "2026-10-05T12:00:00.000Z",
    units: 3,
  };
  const rental = {
    bookingMode: "DAILY" as const,
    startTime: "2026-09-28T10:00:00.000Z",
    endTime: "2026-09-30T10:00:00.000Z",
    units: 2,
  };
  const slot = {
    bookingMode: "SLOT" as const,
    startTime: "2026-09-28T13:00:00.000Z",
    endTime: "2026-09-28T17:00:00.000Z",
    units: 1,
  };

  it("describes a stay", () => {
    expect(bookingWhen(stay)).toBe("Check-in Fri 2 Oct from 14:00 · Check-out Mon 5 Oct by 12:00 · 3 nights");
    expect(bookingSpan(stay)).toBe("2–5 Oct · 3 nights");
  });
  it("describes a rental", () => {
    expect(bookingWhen(rental)).toBe("Pickup Mon 28 Sep, 10:00 · Return Wed 30 Sep, 10:00 · 2 days");
    expect(bookingSpan(rental)).toBe("28–30 Sep · 2 days");
  });
  it("spans months", () => {
    expect(bookingSpan({ ...stay, startTime: "2026-09-30T14:00:00.000Z", endTime: "2026-10-02T12:00:00.000Z", units: 2 })).toBe(
      "30 Sep–2 Oct · 2 nights",
    );
  });
  it("keeps the slot wording", () => {
    expect(bookingWhen(slot)).toBe("Mon 28 Sep at 13:00");
    expect(bookingSpan(slot)).toBe("Mon 28 Sep at 13:00");
  });
});

describe("today's event labels", () => {
  it("names each kind", () => {
    expect(todayEventLabel("CHECK_IN")).toBe("Check-in");
    expect(todayEventLabel("CHECK_OUT")).toBe("Check-out");
    expect(todayEventLabel("PICKUP")).toBe("Pickup");
    expect(todayEventLabel("RETURN")).toBe("Return");
    expect(todayEventLabel("SLOT")).toBe("");
  });
});

describe("calendar dates", () => {
  it("lists dates in a half-open range", () => {
    expect(eachDate("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(daysBetween("2026-09-29", "2026-10-02")).toBe(3);
  });
  it("works with months", () => {
    expect(monthStart("2026-10-17")).toBe("2026-10-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-10-01", -1)).toBe("2026-09-01");
    expect(formatMonth("2026-10-01")).toBe("October 2026");
  });
  it("sizes the nights window to fit the longest stay", () => {
    expect(nightsWindow("2026-10-01", 30)).toEqual({ from: "2026-10-01", to: "2026-12-01" });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `yarn test src/utils/format.test.ts`
Expected: FAIL (`bookingSpan` etc. are not exported).

- [ ] **Step 3: Implement**

In `src/utils/format.ts`, add at the top below the header comment:

```ts
import type { BookingMode } from "@prisma/client";
```

Replace the existing `serviceLabel` with:

```ts
/**
 * The product's service label: "Knotless braids — NGN 25,000 (4 hr)",
 * "Lekki 2-bed, Unit 4B — NGN 85,000 / night", "Toyota Prado — NGN 70,000 / day".
 */
export function serviceLabel(service: {
  name: string;
  price: number | string;
  duration: number;
  currency: string;
  bookingMode?: BookingMode;
}) {
  const price = formatMoney(service.price, service.currency);
  const mode = service.bookingMode ?? "SLOT";
  if (mode === "SLOT") return `${service.name} — ${price} (${formatDuration(service.duration)})`;
  return `${service.name} — ${price} / ${unitNoun(mode, 1)}`;
}
```

Append to the end of the file:

```ts
// ---------- Stays and rentals ----------

/** A booking's times, as the wire carries them. */
export type BookingTimes = {
  bookingMode: BookingMode;
  startTime: string;
  endTime: string;
  units: number;
};

/** "night" / "nights" / "day" / "days". Slot services never count units. */
export function unitNoun(mode: BookingMode, n: number) {
  const word = mode === "NIGHTLY" ? "night" : "day";
  return n === 1 ? word : `${word}s`;
}

/** "3 nights", "1 day". */
export function unitCount(mode: BookingMode, n: number) {
  return `${n} ${unitNoun(mode, n)}`;
}

/** ISO → "Fri 2 Oct" (wall-clock UTC). */
function shortDay(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** ISO → "2 Oct" (wall-clock UTC). */
function dayMonth(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
}

/**
 * The full "when" of a booking:
 * "Mon 28 Sep at 13:00",
 * "Check-in Fri 2 Oct from 14:00 · Check-out Mon 5 Oct by 12:00 · 3 nights",
 * "Pickup Mon 28 Sep, 10:00 · Return Wed 30 Sep, 10:00 · 2 days".
 */
export function bookingWhen(b: BookingTimes) {
  if (b.bookingMode === "SLOT") return formatSlotMoment(b.startTime);
  const count = unitCount(b.bookingMode, b.units);
  if (b.bookingMode === "NIGHTLY") {
    return `Check-in ${shortDay(b.startTime)} from ${formatSlotTime(b.startTime)} · Check-out ${shortDay(b.endTime)} by ${formatSlotTime(b.endTime)} · ${count}`;
  }
  return `Pickup ${shortDay(b.startTime)}, ${formatSlotTime(b.startTime)} · Return ${shortDay(b.endTime)}, ${formatSlotTime(b.endTime)} · ${count}`;
}

/** A compact "when" for lists and subject lines: "2–5 Oct · 3 nights", "30 Sep–2 Oct · 2 nights". */
export function bookingSpan(b: BookingTimes) {
  if (b.bookingMode === "SLOT") return formatSlotMoment(b.startTime);
  const sameMonth = b.startTime.slice(0, 7) === b.endTime.slice(0, 7);
  const from = sameMonth ? String(new Date(b.startTime).getUTCDate()) : dayMonth(b.startTime);
  return `${from}–${dayMonth(b.endTime)} · ${unitCount(b.bookingMode, b.units)}`;
}

/** What happens at a time in today's list. */
export type TodayEventKind = "SLOT" | "CHECK_IN" | "CHECK_OUT" | "PICKUP" | "RETURN";

const TODAY_EVENT_LABEL: Record<TodayEventKind, string> = {
  SLOT: "",
  CHECK_IN: "Check-in",
  CHECK_OUT: "Check-out",
  PICKUP: "Pickup",
  RETURN: "Return",
};

export function todayEventLabel(kind: TodayEventKind) {
  return TODAY_EVENT_LABEL[kind];
}

/** Every YYYY-MM-DD in [from, to). */
export function eachDate(from: string, to: string) {
  const dates: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) dates.push(d);
  return dates;
}

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string) {
  return Math.round(
    (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86_400_000,
  );
}

/** "2026-10-17" → "2026-10-01". */
export function monthStart(isoDate: string) {
  return `${isoDate.slice(0, 7)}-01`;
}

/** "2026-12-01" + 1 → "2027-01-01". */
export function addMonths(month: string, n: number) {
  const date = new Date(`${month}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + n);
  return date.toISOString().slice(0, 10);
}

/** "2026-10-01" → "October 2026". */
export function formatMonth(month: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}T00:00:00.000Z`),
  );
}

/**
 * The nights a stay calendar loads for a month: the month itself plus room
 * for the longest stay starting in it, rounded to whole months.
 */
export function nightsWindow(month: string, maxUnits: number) {
  return { from: month, to: addMonths(month, 1 + Math.ceil(maxUnits / 30)) };
}
```

(`nightsWindow("2026-10-01", 30)` → to `2026-12-01`; with `maxUnits` 90 → `2027-02-01`, 123 days, within the 125-day route limit.)

- [ ] **Step 4: Run the tests**

Run: `yarn test src/utils/format.test.ts && yarn typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/format.ts src/utils/format.test.ts
git commit -m "feat: wording helpers for stays, rentals and calendar months"
```

---

### Task 3: Booking terms (end time and price)

**Files:**
- Create: `src/backend/services/booking/clock.ts`
- Create: `src/backend/services/booking/terms.ts`
- Test: `src/backend/services/booking/terms.test.ts`

**Interfaces:**
- Consumes: `addDays`, `unitNoun`, `unitCount` from `@/utils/format` (Task 2).
- Produces:
  - `clock.ts`: `DAY_MS`, `wallClockNow(now?: Date): Date`, `atTime(date: string, time: string): Date`, `dateOf(moment: Date): string`, `timeOf(moment: Date): string`
  - `terms.ts`: `HORIZON_DAYS = 180`, `type TermsService`, `type BookingTerms = { endTime: Date; units: number; amount: Prisma.Decimal }`, `bookingTerms(service: TermsService, startTime: Date, units?: number, options?: { now?: Date; enforceUnitLimits?: boolean }): BookingTerms` (throws `BadRequestException`)

- [ ] **Step 1: Write the failing tests**

`src/backend/services/booking/terms.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { BadRequestException } from "@/utils/exceptions";

import { bookingTerms, type TermsService } from "./terms";

// Real now 2026-10-01T09:00Z = 10:00 Lagos wall-clock.
const NOW = new Date("2026-10-01T09:00:00.000Z");
const at = (iso: string) => new Date(iso);

const SLOT: TermsService = {
  bookingMode: "SLOT", price: 25000, duration: 240,
  checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 30,
};
const STAY: TermsService = {
  bookingMode: "NIGHTLY", price: 85000, duration: 1440,
  checkInTime: "14:00", checkOutTime: "12:00", minUnits: 2, maxUnits: 30,
};
const CAR: TermsService = {
  bookingMode: "DAILY", price: 70000, duration: 1440,
  checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 14,
};

describe("bookingTerms: SLOT", () => {
  it("ends after the duration and costs the price", () => {
    const terms = bookingTerms(SLOT, at("2026-10-02T13:00:00.000Z"), 5, { now: NOW });
    expect(terms.endTime).toEqual(at("2026-10-02T17:00:00.000Z"));
    expect(terms.units).toBe(1);
    expect(terms.amount.toString()).toBe("25000");
  });
  it("rejects a slot that started earlier today in Lagos", () => {
    // 09:30 wall-clock is before 10:00 Lagos now, though after 09:00 real UTC.
    expect(() => bookingTerms(SLOT, at("2026-10-01T09:30:00.000Z"), 1, { now: NOW })).toThrow(BadRequestException);
  });
});

describe("bookingTerms: NIGHTLY", () => {
  it("checks out on the last morning and charges per night", () => {
    const terms = bookingTerms(STAY, at("2026-10-02T14:00:00.000Z"), 3, { now: NOW });
    expect(terms.endTime).toEqual(at("2026-10-05T12:00:00.000Z"));
    expect(terms.units).toBe(3);
    expect(terms.amount.toString()).toBe("255000");
  });
  it("accepts a check-in tonight even after the check-in hour", () => {
    const evening = new Date("2026-10-01T17:00:00.000Z"); // 18:00 Lagos
    expect(() => bookingTerms(STAY, at("2026-10-01T14:00:00.000Z"), 2, { now: evening })).not.toThrow();
  });
  it("rejects yesterday", () => {
    expect(() => bookingTerms(STAY, at("2026-09-30T14:00:00.000Z"), 2, { now: NOW })).toThrow("That check-in date has passed");
  });
  it("rejects a start that isn't the check-in time", () => {
    expect(() => bookingTerms(STAY, at("2026-10-02T10:00:00.000Z"), 2, { now: NOW })).toThrow("Check-in is from 14:00.");
  });
  it("enforces min and max nights", () => {
    expect(() => bookingTerms(STAY, at("2026-10-02T14:00:00.000Z"), 1, { now: NOW })).toThrow("Book between 2 and 30 nights.");
    expect(() => bookingTerms(STAY, at("2026-10-02T14:00:00.000Z"), 31, { now: NOW })).toThrow(BadRequestException);
  });
  it("can skip unit limits for an owner moving an existing stay", () => {
    expect(() =>
      bookingTerms(STAY, at("2026-10-02T14:00:00.000Z"), 1, { now: NOW, enforceUnitLimits: false }),
    ).not.toThrow();
  });
  it("refuses a stay without check-in and check-out times", () => {
    expect(() =>
      bookingTerms({ ...STAY, checkInTime: null }, at("2026-10-02T14:00:00.000Z"), 2, { now: NOW }),
    ).toThrow(BadRequestException);
  });
});

describe("bookingTerms: DAILY", () => {
  it("returns 24 hours per day and charges per day", () => {
    const terms = bookingTerms(CAR, at("2026-10-05T10:00:00.000Z"), 2, { now: NOW });
    expect(terms.endTime).toEqual(at("2026-10-07T10:00:00.000Z"));
    expect(terms.amount.toString()).toBe("140000");
  });
  it("only picks up on the hour", () => {
    expect(() => bookingTerms(CAR, at("2026-10-05T10:30:00.000Z"), 2, { now: NOW })).toThrow("Pickup times are on the hour.");
  });
  it("rejects a pickup time that has passed", () => {
    expect(() => bookingTerms(CAR, at("2026-10-01T09:00:00.000Z"), 1, { now: NOW })).toThrow(BadRequestException);
  });
});

describe("bookingTerms: horizon", () => {
  it("rejects starts more than 180 days ahead", () => {
    expect(() => bookingTerms(CAR, at("2027-04-01T10:00:00.000Z"), 1, { now: NOW })).toThrow(
      "Bookings open up to 180 days ahead.",
    );
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `yarn test src/backend/services/booking/terms.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `clock.ts`**

```ts
/*
 * Booking times are wall-clock times written in UTC: a 14:00 check-in is
 * stored as 14:00Z (see utils/format.ts). These helpers keep that convention.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no daylight saving

/** Lagos wall-clock now, written in UTC like every stored booking time. */
export function wallClockNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + LAGOS_OFFSET_MS);
}

/** "2026-10-02" + "14:00" → 2026-10-02T14:00:00.000Z. */
export function atTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00.000Z`);
}

/** The YYYY-MM-DD of a stored moment. */
export function dateOf(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

/** The HH:mm of a stored moment. */
export function timeOf(moment: Date): string {
  return moment.toISOString().slice(11, 16);
}
```

- [ ] **Step 4: Implement `terms.ts`**

```ts
import { Prisma, type BookingMode } from "@prisma/client";

import { BadRequestException } from "@/utils/exceptions";
import { addDays, unitCount, unitNoun } from "@/utils/format";

import { DAY_MS, atTime, dateOf, timeOf, wallClockNow } from "./clock";

export const HORIZON_DAYS = 180;
const HOUR_MS = 60 * 60 * 1000;

/** What the terms need to know about a service. */
export type TermsService = {
  bookingMode: BookingMode;
  price: Prisma.Decimal | number | string;
  duration: number;
  checkInTime: string | null;
  checkOutTime: string | null;
  minUnits: number;
  maxUnits: number;
};

export type BookingTerms = {
  endTime: Date;
  /** Nights or days; 1 for a slot. */
  units: number;
  /** price × units. */
  amount: Prisma.Decimal;
};

/**
 * When a booking ends and what it costs, from when it starts and how many
 * nights or days it runs. The server's only source for both: clients never
 * send an end time or a price for stays and rentals.
 */
export function bookingTerms(
  service: TermsService,
  startTime: Date,
  units = 1,
  options: { now?: Date; enforceUnitLimits?: boolean } = {},
): BookingTerms {
  const now = wallClockNow(options.now);
  const today = dateOf(now);

  if (dateOf(startTime) > addDays(today, HORIZON_DAYS)) {
    throw new BadRequestException(`Bookings open up to ${HORIZON_DAYS} days ahead. Pick an earlier date.`);
  }

  if (service.bookingMode === "SLOT") {
    if (startTime < now) throw new BadRequestException("That time has passed. Pick a later one.");
    return {
      endTime: new Date(startTime.getTime() + service.duration * 60 * 1000),
      units: 1,
      amount: new Prisma.Decimal(service.price),
    };
  }

  const mode = service.bookingMode;
  if (!Number.isInteger(units) || units < 1) {
    throw new BadRequestException(`Pick how many ${unitNoun(mode, 2)}.`);
  }
  if (options.enforceUnitLimits !== false && (units < service.minUnits || units > service.maxUnits)) {
    throw new BadRequestException(
      service.minUnits === service.maxUnits
        ? `This books for exactly ${unitCount(mode, service.minUnits)}.`
        : `Book between ${service.minUnits} and ${service.maxUnits} ${unitNoun(mode, service.maxUnits)}.`,
    );
  }
  const amount = new Prisma.Decimal(service.price).mul(units);

  if (mode === "NIGHTLY") {
    if (!service.checkInTime || !service.checkOutTime) {
      throw new BadRequestException("This stay can't be booked yet: its check-in and check-out times aren't set.");
    }
    if (timeOf(startTime) !== service.checkInTime) {
      throw new BadRequestException(`Check-in is from ${service.checkInTime}.`);
    }
    // By date, not time: a guest may book tonight's stay after the check-in hour.
    if (dateOf(startTime) < today) {
      throw new BadRequestException("That check-in date has passed. Pick a later one.");
    }
    return {
      endTime: atTime(addDays(dateOf(startTime), units), service.checkOutTime),
      units,
      amount,
    };
  }

  if (startTime.getTime() % HOUR_MS !== 0) {
    throw new BadRequestException("Pickup times are on the hour.");
  }
  if (startTime < now) throw new BadRequestException("That pickup time has passed. Pick a later one.");
  return { endTime: new Date(startTime.getTime() + units * DAY_MS), units, amount };
}
```

- [ ] **Step 5: Run the tests**

Run: `yarn test src/backend/services/booking/terms.test.ts && yarn typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/backend/services/booking/clock.ts src/backend/services/booking/terms.ts src/backend/services/booking/terms.test.ts
git commit -m "feat: booking terms work out end time and price for each mode"
```

---

### Task 4: Conflict scope and payment holds

**Files:**
- Create: `src/backend/services/booking/conflicts.ts`
- Test: `src/backend/services/booking/conflicts.test.ts`

**Interfaces:**
- Produces:
  - `HOLD_MINUTES = 30`
  - `holdExpiresFrom(now: Date): Date`
  - `type ConflictService = { id: string; businessId: string; bookingMode: BookingMode }`
  - `activeBookingWhere(now?: Date): Prisma.BookingWhereInput`
  - `blockingBookingsWhere(service: ConflictService, range: { start: Date; end: Date }, options?: { now?: Date; excludeId?: string }): Prisma.BookingWhereInput`

- [ ] **Step 1: Write the failing tests**

`src/backend/services/booking/conflicts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { activeBookingWhere, blockingBookingsWhere, holdExpiresFrom } from "./conflicts";

const NOW = new Date("2026-10-01T09:00:00.000Z");
const RANGE = { start: new Date("2026-10-02T14:00:00.000Z"), end: new Date("2026-10-05T12:00:00.000Z") };

describe("activeBookingWhere", () => {
  it("counts confirmed bookings and unpaid ones whose hold is still live", () => {
    expect(activeBookingWhere(NOW)).toEqual({
      OR: [
        { status: "CONFIRMED" },
        { status: "PENDING", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: NOW } }] },
      ],
    });
  });
});

describe("holdExpiresFrom", () => {
  it("holds for 30 minutes", () => {
    expect(holdExpiresFrom(NOW)).toEqual(new Date("2026-10-01T09:30:00.000Z"));
  });
});

describe("blockingBookingsWhere", () => {
  it("scopes a slot service to the owner's other slot bookings, business-wide", () => {
    const where = blockingBookingsWhere({ id: "svc_1", businessId: "biz_1", bookingMode: "SLOT" }, RANGE, { now: NOW });
    expect(where).toEqual({
      businessId: "biz_1",
      service: { bookingMode: "SLOT" },
      startTime: { lt: RANGE.end },
      endTime: { gt: RANGE.start },
      AND: [activeBookingWhere(NOW)],
    });
  });

  it("scopes a stay or rental to the same service only", () => {
    const where = blockingBookingsWhere({ id: "svc_4b", businessId: "biz_1", bookingMode: "NIGHTLY" }, RANGE, { now: NOW });
    expect(where).toEqual({
      serviceId: "svc_4b",
      startTime: { lt: RANGE.end },
      endTime: { gt: RANGE.start },
      AND: [activeBookingWhere(NOW)],
    });
    expect(where).not.toHaveProperty("businessId");
  });

  it("can leave out the booking being moved", () => {
    const where = blockingBookingsWhere(
      { id: "svc_car", businessId: "biz_1", bookingMode: "DAILY" },
      RANGE,
      { now: NOW, excludeId: "bkg_1" },
    );
    expect(where).toMatchObject({ serviceId: "svc_car", id: { not: "bkg_1" } });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `yarn test src/backend/services/booking/conflicts.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/backend/services/booking/conflicts.ts`:

```ts
import type { BookingMode, Prisma } from "@prisma/client";

/** How long an unpaid booking keeps its time while the customer pays. */
export const HOLD_MINUTES = 30;

export function holdExpiresFrom(now: Date): Date {
  return new Date(now.getTime() + HOLD_MINUTES * 60 * 1000);
}

/** What the conflict rule needs to know about a service. */
export type ConflictService = {
  id: string;
  businessId: string;
  bookingMode: BookingMode;
};

/**
 * Bookings that still hold their time: confirmed, or unpaid with a live hold.
 * `now` is a real instant (holds are real deadlines, not wall-clock times).
 */
export function activeBookingWhere(now: Date = new Date()): Prisma.BookingWhereInput {
  return {
    OR: [
      { status: "CONFIRMED" },
      { status: "PENDING", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
    ],
  };
}

/**
 * The bookings that stop `service` from being booked over `range`.
 *
 * A slot service uses the owner's own time, so any other slot booking in the
 * business blocks it. A stay or rental is a unit (one apartment, one car), so
 * only bookings of that same service block it. The two never block each other.
 * Availability, booking creation and reschedules all use this one rule.
 */
export function blockingBookingsWhere(
  service: ConflictService,
  range: { start: Date; end: Date },
  options: { now?: Date; excludeId?: string } = {},
): Prisma.BookingWhereInput {
  const scope: Prisma.BookingWhereInput =
    service.bookingMode === "SLOT"
      ? { businessId: service.businessId, service: { bookingMode: "SLOT" } }
      : { serviceId: service.id };

  return {
    ...scope,
    ...(options.excludeId ? { id: { not: options.excludeId } } : {}),
    startTime: { lt: range.end },
    endTime: { gt: range.start },
    AND: [activeBookingWhere(options.now)],
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `yarn test src/backend/services/booking/conflicts.test.ts && yarn typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/booking/conflicts.ts src/backend/services/booking/conflicts.test.ts
git commit -m "feat: one rule for which bookings block which, with 30-minute holds"
```

---

### Task 5: Availability for each mode

**Files:**
- Create: `src/backend/services/availability/slot.ts` (today's logic, moved)
- Create: `src/backend/services/availability/nightly.ts`
- Create: `src/backend/services/availability/daily.ts`
- Modify: `src/backend/services/availability/index.ts` (becomes the dispatcher)
- Modify: `src/backend/services/availability/index.test.ts` (slot fixtures gain `id`, `businessId`, `bookingMode`)
- Test: `src/backend/services/availability/nightly.test.ts`, `src/backend/services/availability/daily.test.ts`

**Interfaces:**
- Consumes: `blockingBookingsWhere` (Task 4), `wallClockNow`, `atTime`, `dateOf`, `timeOf`, `DAY_MS` (Task 3), `HORIZON_DAYS` (Task 3), `addDays`, `eachDate` (Task 2).
- Produces on `availabilityService`:
  - `getAvailableSlots({ businessId, serviceId, date }): Promise<AvailabilitySlot[]>` (unchanged signature)
  - `getNights({ serviceId, from, to, excludeBookingId?, now? }): Promise<NightAvailability[]>`
  - `getPickupTimes({ serviceId, date, units, excludeBookingId?, now? }): Promise<AvailabilitySlot[]>`
  - `type NightAvailability = { date: string; isAvailable: boolean }`

- [ ] **Step 1: Move slot availability**

Create `src/backend/services/availability/slot.ts` with the body of today's `index.ts` moved into a function, changing only the service select and the bookings query:

```ts
import { blockingBookingsWhere } from "@/backend/services/booking/conflicts";
import { googleCalendarService } from "@/backend/services/googleCalendar";
import { db } from "@/server/db";
import { NotFoundException } from "@/utils/exceptions";

export type AvailabilitySlot = {
  startTime: Date;
  endTime: Date;
  isAvailable: boolean;
};

/**
 * Every candidate slot stepping by `durationMinutes` across
 * [availableFrom, availableTo) on the given date.
 */
function generateCandidateSlots(
  date: string,
  availableFrom: string,
  availableTo: string,
  durationMinutes: number,
): { startTime: Date; endTime: Date }[] {
  const slots: { startTime: Date; endTime: Date }[] = [];
  const dayStart = new Date(`${date}T${availableFrom}:00.000Z`);
  const dayEnd = new Date(`${date}T${availableTo}:00.000Z`);
  const durationMs = durationMinutes * 60 * 1000;
  let current = dayStart.getTime();
  while (current + durationMs <= dayEnd.getTime()) {
    slots.push({ startTime: new Date(current), endTime: new Date(current + durationMs) });
    current += durationMs;
  }
  return slots;
}

/** "HH:mm" on the same day as `date`, as a comparable Date. */
function timeOnDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00.000Z`);
}

/**
 * Every candidate slot for a slot service on a date, each flagged
 * `isAvailable` after business hours, closures, the owner's other slot
 * bookings (live holds only) and Google Calendar busy time.
 */
export async function getSlotAvailability(params: {
  businessId: string;
  serviceId: string;
  date: string;
}): Promise<AvailabilitySlot[]> {
  const { businessId, serviceId, date } = params;

  const service = await db.service.findUnique({
    where: { id: serviceId },
    select: { id: true, businessId: true, bookingMode: true, duration: true, availableFrom: true, availableTo: true },
  });
  if (!service) throw new NotFoundException("Service not found");

  const candidates = generateCandidateSlots(date, service.availableFrom, service.availableTo, service.duration);
  if (candidates.length === 0) return [];

  const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay();

  const [businessHours, closure, existingBookings, business] = await Promise.all([
    db.businessHours.findUnique({ where: { businessId_dayOfWeek: { businessId, dayOfWeek } } }),
    db.businessClosure.findUnique({ where: { businessId_date: { businessId, date: new Date(date) } } }),
    db.booking.findMany({
      where: blockingBookingsWhere(
        { id: service.id, businessId, bookingMode: "SLOT" },
        { start: timeOnDate(date, "00:00"), end: timeOnDate(date, "23:59") },
      ),
      select: { startTime: true, endTime: true },
    }),
    db.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        googleCalendarId: true,
        googleCalendarAccessToken: true,
        googleCalendarRefreshToken: true,
        googleCalendarTokenExpiry: true,
      },
    }),
  ]);

  const isClosureDay = closure !== null;
  const busyIntervals = business ? await googleCalendarService.getBusyIntervals(business, date) : [];

  return candidates.map((slot) => {
    const withinBusinessHours = businessHours
      ? !businessHours.isClosed &&
        slot.startTime >= timeOnDate(date, businessHours.startTime) &&
        slot.endTime <= timeOnDate(date, businessHours.endTime)
      : true; // no row configured — legacy default: open all day
    const overlapsExistingBooking = existingBookings.some(
      (booking) => booking.startTime < slot.endTime && booking.endTime > slot.startTime,
    );
    const overlapsBusyInterval = busyIntervals.some(
      (interval) => interval.start < slot.endTime && interval.end > slot.startTime,
    );
    return {
      ...slot,
      isAvailable: withinBusinessHours && !isClosureDay && !overlapsExistingBooking && !overlapsBusyInterval,
    };
  });
}
```

In `index.test.ts`, change the default `service` fixture in `setup()` to include `id: SERVICE_ID, businessId: BUSINESS_ID, bookingMode: "SLOT"` (and widen its type the same way). The test at line ~196 (`where: expect.objectContaining({ businessId: BUSINESS_ID })`) still holds.

- [ ] **Step 2: Write the failing nightly tests**

`src/backend/services/availability/nightly.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: { service: { findUnique: vi.fn() }, booking: { findMany: vi.fn() } },
}));

import { db } from "@/server/db";
import { BadRequestException } from "@/utils/exceptions";

import { getNights } from "./nightly";

const mockedDb = db as any;
const NOW = new Date("2026-10-01T09:00:00.000Z"); // 10:00 Lagos
const STAY = {
  id: "svc_4b", businessId: "biz_1", bookingMode: "NIGHTLY",
  checkInTime: "14:00", checkOutTime: "12:00",
};
const booked = (from: string, to: string) => ({
  startTime: new Date(`${from}T14:00:00.000Z`),
  endTime: new Date(`${to}T12:00:00.000Z`),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.service.findUnique.mockResolvedValue(STAY);
  mockedDb.booking.findMany.mockResolvedValue([]);
});

describe("getNights", () => {
  it("returns one entry per night in [from, to)", async () => {
    const nights = await getNights({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-10-04", now: NOW });
    expect(nights.map((n) => n.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(nights.every((n) => n.isAvailable)).toBe(true);
  });

  it("marks booked nights and allows check-in on a check-out day", async () => {
    mockedDb.booking.findMany.mockResolvedValue([booked("2026-10-02", "2026-10-04")]);
    const nights = await getNights({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-10-06", now: NOW });
    expect(Object.fromEntries(nights.map((n) => [n.date, n.isAvailable]))).toEqual({
      "2026-10-01": true,
      "2026-10-02": false,
      "2026-10-03": false,
      "2026-10-04": true, // the previous guest leaves at 12:00, the next arrives at 14:00
      "2026-10-05": true,
    });
  });

  it("keeps tonight open after the check-in hour and closes past nights", async () => {
    const evening = new Date("2026-10-01T17:00:00.000Z"); // 18:00 Lagos
    const nights = await getNights({ serviceId: "svc_4b", from: "2026-09-30", to: "2026-10-02", now: evening });
    expect(nights).toEqual([
      { date: "2026-09-30", isAvailable: false },
      { date: "2026-10-01", isAvailable: true },
    ]);
  });

  it("queries only this apartment's bookings", async () => {
    await getNights({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-10-04", now: NOW });
    const where = mockedDb.booking.findMany.mock.calls[0][0].where;
    expect(where.serviceId).toBe("svc_4b");
    expect(where).not.toHaveProperty("businessId");
  });

  it("passes the booking being moved through as excluded", async () => {
    await getNights({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-10-04", excludeBookingId: "bkg_1", now: NOW });
    expect(mockedDb.booking.findMany.mock.calls[0][0].where.id).toEqual({ not: "bkg_1" });
  });

  it("refuses a service that isn't booked by the night", async () => {
    mockedDb.service.findUnique.mockResolvedValue({ ...STAY, bookingMode: "SLOT" });
    await expect(getNights({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-10-04", now: NOW })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `yarn test src/backend/services/availability/nightly.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `nightly.ts`**

```ts
import { atTime, dateOf, wallClockNow } from "@/backend/services/booking/clock";
import { blockingBookingsWhere } from "@/backend/services/booking/conflicts";
import { HORIZON_DAYS } from "@/backend/services/booking/terms";
import { db } from "@/server/db";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";
import { addDays, eachDate } from "@/utils/format";

export type NightAvailability = { date: string; isAvailable: boolean };

/**
 * Each night in [from, to) for one apartment. Night d runs from d at
 * check-in to d+1 at check-out; it is free when no blocking booking of the
 * same service overlaps it. Because check-out is never later than check-in,
 * a guest can arrive the day another leaves. Business hours, closures and
 * the owner's Google Calendar don't apply to stays.
 */
export async function getNights(params: {
  serviceId: string;
  from: string;
  to: string;
  excludeBookingId?: string;
  now?: Date;
}): Promise<NightAvailability[]> {
  const service = await db.service.findUnique({
    where: { id: params.serviceId },
    select: { id: true, businessId: true, bookingMode: true, checkInTime: true, checkOutTime: true },
  });
  if (!service) throw new NotFoundException("Service not found");
  if (service.bookingMode !== "NIGHTLY" || !service.checkInTime || !service.checkOutTime) {
    throw new BadRequestException("This service isn't booked by the night");
  }
  const { checkInTime, checkOutTime } = service;

  const bookings = await db.booking.findMany({
    where: blockingBookingsWhere(
      service,
      { start: atTime(params.from, checkInTime), end: atTime(params.to, checkOutTime) },
      { now: params.now, excludeId: params.excludeBookingId },
    ),
    select: { startTime: true, endTime: true },
  });

  const today = dateOf(wallClockNow(params.now));
  const lastNight = addDays(today, HORIZON_DAYS);

  return eachDate(params.from, params.to).map((date) => {
    const start = atTime(date, checkInTime);
    const end = atTime(addDays(date, 1), checkOutTime);
    const taken = bookings.some((b) => b.startTime < end && b.endTime > start);
    return { date, isAvailable: date >= today && date <= lastNight && !taken };
  });
}
```

- [ ] **Step 5: Write the failing daily tests**

`src/backend/services/availability/daily.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    service: { findUnique: vi.fn() },
    businessHours: { findUnique: vi.fn() },
    businessClosure: { findUnique: vi.fn() },
    booking: { findMany: vi.fn() },
  },
}));

import { db } from "@/server/db";
import { BadRequestException } from "@/utils/exceptions";

import { getPickupTimes } from "./daily";

const mockedDb = db as any;
const NOW = new Date("2026-10-01T09:00:00.000Z"); // 10:00 Lagos
const CAR = {
  id: "svc_car", businessId: "biz_1", bookingMode: "DAILY",
  availableFrom: "08:00", availableTo: "12:00", minUnits: 1, maxUnits: 14,
};
const at = (iso: string) => new Date(iso);

type Hours = { isClosed: boolean; startTime: string; endTime: string } | null;

function setup({
  hours = {} as Record<number, Hours>,
  closures = [] as string[],
  bookings = [] as { startTime: Date; endTime: Date }[],
} = {}) {
  mockedDb.service.findUnique.mockResolvedValue(CAR);
  mockedDb.businessHours.findUnique.mockImplementation(
    async (args: { where: { businessId_dayOfWeek: { dayOfWeek: number } } }) =>
      hours[args.where.businessId_dayOfWeek.dayOfWeek] ?? null,
  );
  mockedDb.businessClosure.findUnique.mockImplementation(
    async (args: { where: { businessId_date: { date: Date } } }) =>
      closures.includes(args.where.businessId_date.date.toISOString().slice(0, 10)) ? { id: "c" } : null,
  );
  mockedDb.booking.findMany.mockResolvedValue(bookings);
}

beforeEach(() => vi.clearAllMocks());

describe("getPickupTimes", () => {
  it("offers whole hours from availableFrom up to availableTo, returning units × 24h later", async () => {
    setup();
    const times = await getPickupTimes({ serviceId: "svc_car", date: "2026-10-05", units: 2, now: NOW });
    expect(times.map((t) => t.startTime.toISOString().slice(11, 16))).toEqual(["08:00", "09:00", "10:00", "11:00"]);
    expect(times[0]!.endTime).toEqual(at("2026-10-07T08:00:00.000Z"));
    expect(times.every((t) => t.isAvailable)).toBe(true);
  });

  it("closes pickups that would return on a day off", async () => {
    setup({ closures: ["2026-10-07"] });
    const times = await getPickupTimes({ serviceId: "svc_car", date: "2026-10-05", units: 2, now: NOW });
    expect(times.every((t) => !t.isAvailable)).toBe(true);
  });

  it("closes pickups whose return falls outside working hours", async () => {
    // 2026-10-07 is a Wednesday (3): open 10:00–18:00, so 08:00 and 09:00 returns are out.
    setup({ hours: { 3: { isClosed: false, startTime: "10:00", endTime: "18:00" } } });
    const times = await getPickupTimes({ serviceId: "svc_car", date: "2026-10-05", units: 2, now: NOW });
    expect(times.map((t) => t.isAvailable)).toEqual([false, false, true, true]);
  });

  it("closes pickups that overlap a rental of the same car", async () => {
    setup({ bookings: [{ startTime: at("2026-10-06T09:00:00.000Z"), endTime: at("2026-10-07T09:00:00.000Z") }] });
    const times = await getPickupTimes({ serviceId: "svc_car", date: "2026-10-05", units: 1, now: NOW });
    // 1-day rentals from 08:00 end 08:00 on the 6th (free); from 10:00 end 10:00 on the 6th (overlaps).
    expect(times.map((t) => t.isAvailable)).toEqual([true, true, false, false]);
    expect(mockedDb.booking.findMany.mock.calls[0][0].where.serviceId).toBe("svc_car");
  });

  it("closes pickup times that have passed today", async () => {
    setup();
    const times = await getPickupTimes({ serviceId: "svc_car", date: "2026-10-01", units: 1, now: NOW });
    expect(times.map((t) => t.isAvailable)).toEqual([false, false, true, true]); // 10:00 Lagos now
  });

  it("refuses units outside the car's limits", async () => {
    setup();
    await expect(getPickupTimes({ serviceId: "svc_car", date: "2026-10-05", units: 15, now: NOW })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
```

Note on the 10:00 pickup "today": `start < wallNow` is false at exactly 10:00, so it stays available.

- [ ] **Step 6: Implement `daily.ts`**

```ts
import { DAY_MS, atTime, dateOf, timeOf, wallClockNow } from "@/backend/services/booking/clock";
import { blockingBookingsWhere } from "@/backend/services/booking/conflicts";
import { HORIZON_DAYS } from "@/backend/services/booking/terms";
import { db } from "@/server/db";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";
import { addDays, unitNoun } from "@/utils/format";

import type { AvailabilitySlot } from "./slot";

type Hours = { isClosed: boolean; startTime: string; endTime: string } | null;

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/** A handover at `time` on a day with these hours (no row = open all day). */
function openAt(hours: Hours, time: string) {
  if (!hours) return true;
  return !hours.isClosed && time >= hours.startTime && time <= hours.endTime;
}

/**
 * Pickup times for one car on `date` for a rental of `units` days. A time is
 * free when the pickup and the return (units × 24h later) both fall in
 * working hours on days that aren't days off, and no booking of the same car
 * overlaps the whole rental. The owner's Google Calendar doesn't apply.
 */
export async function getPickupTimes(params: {
  serviceId: string;
  date: string;
  units: number;
  excludeBookingId?: string;
  now?: Date;
}): Promise<AvailabilitySlot[]> {
  const service = await db.service.findUnique({
    where: { id: params.serviceId },
    select: {
      id: true, businessId: true, bookingMode: true,
      availableFrom: true, availableTo: true, minUnits: true, maxUnits: true,
    },
  });
  if (!service) throw new NotFoundException("Service not found");
  if (service.bookingMode !== "DAILY") throw new BadRequestException("This service isn't booked by the day");
  if (!Number.isInteger(params.units) || params.units < service.minUnits || params.units > service.maxUnits) {
    throw new BadRequestException(
      `Book between ${service.minUnits} and ${service.maxUnits} ${unitNoun("DAILY", service.maxUnits)}.`,
    );
  }

  const candidates: Date[] = [];
  for (let m = Math.ceil(minutesOf(service.availableFrom) / 60) * 60; m < minutesOf(service.availableTo); m += 60) {
    const hh = String(m / 60).padStart(2, "0");
    candidates.push(atTime(params.date, `${hh}:00`));
  }
  if (candidates.length === 0) return [];

  const returnDate = addDays(params.date, params.units);
  const { businessId } = service;
  const dayOfWeek = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();

  const [pickupHours, returnHours, pickupClosure, returnClosure, bookings] = await Promise.all([
    db.businessHours.findUnique({ where: { businessId_dayOfWeek: { businessId, dayOfWeek: dayOfWeek(params.date) } } }),
    db.businessHours.findUnique({ where: { businessId_dayOfWeek: { businessId, dayOfWeek: dayOfWeek(returnDate) } } }),
    db.businessClosure.findUnique({ where: { businessId_date: { businessId, date: new Date(params.date) } } }),
    db.businessClosure.findUnique({ where: { businessId_date: { businessId, date: new Date(returnDate) } } }),
    db.booking.findMany({
      where: blockingBookingsWhere(
        service,
        { start: atTime(params.date, "00:00"), end: atTime(addDays(returnDate, 1), "00:00") },
        { now: params.now, excludeId: params.excludeBookingId },
      ),
      select: { startTime: true, endTime: true },
    }),
  ]);

  const wallNow = wallClockNow(params.now);
  const lastDay = addDays(dateOf(wallNow), HORIZON_DAYS);

  return candidates.map((startTime) => {
    const endTime = new Date(startTime.getTime() + params.units * DAY_MS);
    const time = timeOf(startTime);
    const overlaps = bookings.some((b) => b.startTime < endTime && b.endTime > startTime);
    const isAvailable =
      startTime >= wallNow &&
      params.date <= lastDay &&
      openAt(pickupHours, time) &&
      pickupClosure === null &&
      openAt(returnHours, time) &&
      returnClosure === null &&
      !overlaps;
    return { startTime, endTime, isAvailable };
  });
}
```

- [ ] **Step 7: Turn `index.ts` into the dispatcher**

Replace `src/backend/services/availability/index.ts` with:

```ts
import { getPickupTimes } from "./daily";
import { getNights, type NightAvailability } from "./nightly";
import { getSlotAvailability, type AvailabilitySlot } from "./slot";

export type { AvailabilitySlot, NightAvailability };

/** Free time for every booking mode. One entry point per mode. */
class AvailabilityService {
  /** Slot services: every candidate slot on a date, flagged. */
  getAvailableSlots(params: { businessId: string; serviceId: string; date: string }) {
    return getSlotAvailability(params);
  }

  /** Nightly services (shortlets): each night in [from, to), flagged. */
  getNights(params: Parameters<typeof getNights>[0]) {
    return getNights(params);
  }

  /** Daily services (self-drive): pickup times on a date for `units` days, flagged. */
  getPickupTimes(params: Parameters<typeof getPickupTimes>[0]) {
    return getPickupTimes(params);
  }
}

export const availabilityService = new AvailabilityService();
```

- [ ] **Step 8: Run all availability tests**

Run: `yarn test src/backend/services/availability && yarn typecheck`
Expected: PASS (existing slot tests unchanged in behaviour; nightly and daily pass).

- [ ] **Step 9: Commit**

```bash
git add src/backend/services/availability
git commit -m "feat: availability for nights and pickup times, per unit"
```

---

### Task 6: Booking creation

**Files:**
- Modify: `src/backend/services/booking/index.ts`
- Modify: `src/backend/services/booking/index.test.ts`
- Modify: `src/app/api/public/bookings/route.ts`
- Modify: `src/backend/validators/booking.validator.ts` (owner POST: `endTime` optional, `units`)
- Modify: `src/app/api/bookings/route.ts`

**Interfaces:**
- Consumes: `bookingTerms` (Task 3), `blockingBookingsWhere`, `holdExpiresFrom` (Task 4).
- Produces: `CreateBookingInput` now `{ serviceId?; serviceSlug?; startTime: Date; endTime?: Date; units?: number; clientName; clientEmail?; clientPhone?; notes?; payerEmailFallback?; callbackUrl? }`. Conflicts throw `ConflictException` (409). Paystack metadata gains `units`.

- [ ] **Step 1: Update and extend the tests**

In `src/backend/services/booking/index.test.ts`:

1. Change the import line `import { BadRequestException } from "@/utils/exceptions";` to `import { BadRequestException, ConflictException } from "@/utils/exceptions";` and add `import { addDays, todayIso } from "@/utils/format";`.
2. Give `SERVICE` the new fields: `bookingMode: "SLOT", checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 30,`.
3. In "rejects an overlapping slot", expect `ConflictException` instead of `BadRequestException`.
4. Add these tests inside the `describe`:

```ts
  it("stores units, amount and a 30-minute hold", async () => {
    const before = Date.now();
    await bookingService.createWithPayment({ serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada" });
    const data = mockedDb.booking.create.mock.calls[0][0].data;
    expect(data.units).toBe(1);
    expect(data.amount.toString()).toBe("5000");
    expect(data.holdExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
  });

  it("charges price × nights for a stay and works out check-out itself", async () => {
    mockedDb.service.findFirst.mockResolvedValue({
      ...SERVICE, name: "Lekki 2-bed 4B", bookingMode: "NIGHTLY", price: 85000, duration: 1440,
      checkInTime: "14:00", checkOutTime: "12:00",
    });
    const checkIn = addDays(todayIso(), 3);
    await bookingService.createWithPayment({
      serviceSlug: "lekki-4b", startTime: new Date(`${checkIn}T14:00:00.000Z`), units: 3, clientName: "Bisi",
    });
    const data = mockedDb.booking.create.mock.calls[0][0].data;
    expect(data.endTime).toEqual(new Date(`${addDays(checkIn, 3)}T12:00:00.000Z`));
    expect(data.units).toBe(3);
    expect(data.amount.toString()).toBe("255000");
    expect(paystackService.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 25_500_000, metadata: expect.objectContaining({ units: 3 }) }),
    );
  });

  it("checks a stay against the same apartment only", async () => {
    mockedDb.service.findFirst.mockResolvedValue({
      ...SERVICE, bookingMode: "NIGHTLY", price: 85000, duration: 1440, checkInTime: "14:00", checkOutTime: "12:00",
    });
    const checkIn = addDays(todayIso(), 3);
    await bookingService.createWithPayment({
      serviceSlug: "lekki-4b", startTime: new Date(`${checkIn}T14:00:00.000Z`), units: 2, clientName: "Bisi",
    });
    const where = mockedDb.booking.findFirst.mock.calls[0][0].where;
    expect(where.serviceId).toBe("svc_1");
    expect(where).not.toHaveProperty("businessId");
  });

  it("rejects a slot end time that doesn't match the duration", async () => {
    await expect(
      bookingService.createWithPayment({
        serviceSlug: "haircut", startTime: START, endTime: new Date(START.getTime() + 30 * 60 * 1000), clientName: "Ada",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("retries once on a serialization failure, then reports the time as taken", async () => {
    mockedDb.$transaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2034" });
    await expect(
      bookingService.createWithPayment({ serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockedDb.$transaction).toHaveBeenCalledTimes(2);
    expect(paystackService.initializeTransaction).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to see the new tests fail**

Run: `yarn test src/backend/services/booking/index.test.ts`
Expected: FAIL (overlap throws BadRequest; no units/amount/hold; serialization not retried).

- [ ] **Step 3: Rewrite `createWithPayment`**

Replace `src/backend/services/booking/index.ts` with:

```ts
import { paystackService } from "@/backend/services/paystack";
import { db } from "@/server/db";
import { BadRequestException, ConflictException, NotFoundException } from "@/utils/exceptions";
import { Prisma, type Booking } from "@prisma/client";
import slugify from "slugify";

import { blockingBookingsWhere, holdExpiresFrom } from "./conflicts";
import { bookingTerms } from "./terms";

export type CreateBookingInput = {
  serviceId?: string;
  serviceSlug?: string;
  startTime: Date;
  /** Slot services only; when given it must equal startTime + duration. */
  endTime?: Date;
  /** Nights (NIGHTLY) or days (DAILY). Ignored for slot services. */
  units?: number;
  clientName: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  notes?: string | null;
  payerEmailFallback?: string | null;
  /** Where Paystack sends the payer after checkout, built from the new booking. */
  callbackUrl?: (booking: Booking) => string;
};

export type BookingWithPayment = {
  booking: Booking;
  paymentUrl: string;
  paymentReference: string;
};

const SLOT_TAKEN = "This time slot is already booked. Please select a different slot.";
const DATES_TAKEN = "Those dates were just taken. Pick different dates.";

/** Postgres refused a serializable transaction because another one won the race. */
function isSerializationFailure(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2034";
}

class BookingService {
  async createWithPayment(input: CreateBookingInput): Promise<BookingWithPayment> {
    if (!input.serviceId && !input.serviceSlug) {
      throw new BadRequestException("A serviceId or serviceSlug is required");
    }

    const businessSelect = {
      business: { select: { id: true, name: true, paystackSubaccountCode: true, currency: true } },
    } as const;

    const service = input.serviceId
      ? await db.service.findUnique({ where: { id: input.serviceId }, include: businessSelect })
      : await db.service.findFirst({ where: { slug: input.serviceSlug }, include: businessSelect });

    if (!service) throw new NotFoundException("Service not found");
    if (!service.isActive) {
      throw new BadRequestException("This service is currently unavailable for booking");
    }
    if (!service.business.paystackSubaccountCode) {
      throw new BadRequestException(
        "This business has not set up payment processing. Please contact the service provider.",
      );
    }

    const terms = bookingTerms(service, input.startTime, input.units ?? 1);
    if (service.bookingMode === "SLOT" && input.endTime && input.endTime.getTime() !== terms.endTime.getTime()) {
      const slotMinutes = (input.endTime.getTime() - input.startTime.getTime()) / (60 * 1000);
      throw new BadRequestException(
        `Slot duration (${slotMinutes} min) does not match service duration (${service.duration} min)`,
      );
    }

    const range = { start: input.startTime, end: terms.endTime };
    const takenMessage = service.bookingMode === "SLOT" ? SLOT_TAKEN : DATES_TAKEN;

    // Check and insert in one serializable transaction, so two customers
    // paying for the same time at the same moment can't both get through.
    const insert = () =>
      db.$transaction(
        async (tx) => {
          const now = new Date();
          const overlapping = await tx.booking.findFirst({
            where: blockingBookingsWhere(service, range, { now }),
            select: { id: true },
          });
          if (overlapping) throw new ConflictException(takenMessage);

          let slug = slugify(`${service.name}-${input.clientName}-${Date.now()}`, { lower: true, strict: true });
          for (let attempts = 0; attempts < 10; attempts++) {
            const existing = await tx.booking.findUnique({ where: { slug } });
            if (!existing) break;
            slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
          }

          const data: Prisma.BookingCreateInput = {
            slug,
            business: { connect: { id: service.business.id } },
            service: { connect: { id: service.id } },
            startTime: input.startTime,
            endTime: terms.endTime,
            units: terms.units,
            amount: terms.amount,
            holdExpiresAt: holdExpiresFrom(now),
            clientName: input.clientName,
            clientEmail: input.clientEmail ?? null,
            clientPhone: input.clientPhone ?? null,
            notes: input.notes ?? null,
            status: "PENDING",
          };
          return tx.booking.create({ data });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

    let booking: Booking;
    try {
      booking = await insert();
    } catch (error) {
      if (!isSerializationFailure(error)) throw error;
      try {
        booking = await insert();
      } catch (retryError) {
        if (isSerializationFailure(retryError)) throw new ConflictException(takenMessage);
        throw retryError;
      }
    }

    const payerEmail = input.clientEmail || input.payerEmailFallback || "customer@sara.app";
    const transaction = await paystackService.initializeTransaction({
      email: payerEmail,
      amount: Math.round(terms.amount.mul(100).toNumber()),
      subaccountCode: service.business.paystackSubaccountCode,
      callbackUrl: input.callbackUrl?.(booking),
      metadata: {
        bookingId: booking.id,
        bookingSlug: booking.slug,
        serviceId: service.id,
        serviceName: service.name,
        businessId: service.business.id,
        businessName: service.business.name,
        clientName: input.clientName,
        units: terms.units,
      },
      bearer: "account",
    });

    return { booking, paymentUrl: transaction.authorization_url, paymentReference: transaction.reference };
  }
}

export const bookingService = new BookingService();
```

If `paystackService.initializeTransaction`'s `metadata` type rejects `units: number`, widen that type in `src/backend/services/paystack/index.ts` to `Record<string, string | number>`.

- [ ] **Step 4: Accept `units` on the public route**

In `src/app/api/public/bookings/route.ts`, change the schema and call:

```ts
const publicBookingSchema = z
  .object({
    serviceSlug: z.string().min(1, "serviceSlug is required"),
    startTime: z.coerce.date(),
    // Slot services only; stays and rentals send units and the server works out the end.
    endTime: z.coerce.date().optional(),
    units: z.coerce.number().int().min(1).max(90).optional(),
    clientName: z.string().min(1, "clientName is required").max(255),
    clientEmail: z.string().email("clientEmail must be a valid email").optional(),
    clientPhone: z.string().max(20).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();
```

and in `bookingService.createWithPayment({ … })` add `units: data.units,` after `endTime: data.endTime,`.

- [ ] **Step 5: Accept `units` on the owner route**

In `src/backend/validators/booking.validator.ts`, in `bookingValidatorSchema` change `endTime: dateValidator("endTime"),` to:

```ts
  endTime: dateValidator("endTime").optional(),
  units: z.coerce.number().int().min(1, "units must be at least 1").max(90, "units cannot exceed 90").optional(),
```

In `src/app/api/bookings/route.ts`, change the call's end time and add units:

```ts
          endTime: payload.endTime ? new Date(payload.endTime) : undefined,
          units: payload.units,
```

- [ ] **Step 6: Run the tests**

Run: `yarn test src/backend/services/booking src/app/api/public src/app/api/bookings/route.test.ts && yarn typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/backend/services/booking src/app/api/public/bookings/route.ts src/backend/validators/booking.validator.ts src/app/api/bookings/route.ts src/backend/services/paystack/index.ts
git commit -m "feat: book stays and rentals by units, priced and held server-side"
```

---

### Task 7: Owner reschedule

**Files:**
- Modify: `src/app/api/bookings/[slug]/route.ts` (PUT)
- Modify: `src/app/api/bookings/[slug]/route.test.ts`

**Interfaces:**
- Consumes: `bookingTerms` with `{ enforceUnitLimits: false }` (Task 3), `blockingBookingsWhere` with `excludeId` (Task 4).
- Produces: PUT keeps `units` fixed; for NIGHTLY/DAILY only `startTime` matters (any `endTime` is ignored); overlap → 409.

- [ ] **Step 1: Update the tests**

In `src/app/api/bookings/[slug]/route.test.ts`:

1. Replace `EXISTING_BOOKING.service` with:

```ts
  service: {
    id: "cservice0000000000000001", businessId: BUSINESS.id, bookingMode: "SLOT",
    price: 5000, duration: 60, checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 30,
    name: "Haircut", slug: "haircut",
  },
  units: 1,
```

2. In "rejects the reschedule when it overlaps a booking on a different service of the same business", change `expect(response.status).toBe(400);` to `expect(response.status).toBe(409);`.

3. Add:

```ts
  it("moves a stay by its check-in date, keeping its nights, against this apartment only", async () => {
    const checkIn = addDays(todayIso(), 10);
    mockedDb.booking.findUnique.mockResolvedValue({
      ...EXISTING_BOOKING,
      units: 3,
      service: { ...EXISTING_BOOKING.service, bookingMode: "NIGHTLY", price: 85000, duration: 1440, checkInTime: "14:00", checkOutTime: "12:00" },
    });
    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: { startTime: `${checkIn}T14:00:00.000Z` },
    });

    const response = await PUT(request, { params: Promise.resolve({ slug: EXISTING_BOOKING.slug }) });

    expect(response.status).toBe(200);
    const where = mockedDb.booking.findFirst.mock.calls[0]![0].where;
    expect(where.serviceId).toBe(EXISTING_BOOKING.service.id);
    expect(where.id).toEqual({ not: EXISTING_BOOKING.id });
    expect(mockedDb.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ endTime: new Date(`${addDays(checkIn, 3)}T12:00:00.000Z`) }),
      }),
    );
  });
```

and add `import { addDays, todayIso } from "@/utils/format";` to the imports.

- [ ] **Step 2: Run to see it fail**

Run: `yarn test "src/app/api/bookings/\[slug\]/route.test.ts"`
Expected: FAIL (overlap still 400; stay test fails on duration mismatch).

- [ ] **Step 3: Implement**

In `src/app/api/bookings/[slug]/route.ts` PUT:

1. Add imports:

```ts
import { blockingBookingsWhere } from "@/backend/services/booking/conflicts";
import { bookingTerms } from "@/backend/services/booking/terms";
```

and add `ConflictException` to the existing `@/utils/exceptions` import.

2. Change the booking's `service` select to:

```ts
          service: {
            select: {
              id: true, businessId: true, bookingMode: true, price: true, duration: true,
              checkInTime: true, checkOutTime: true, minUnits: true, maxUnits: true,
              name: true, slug: true,
            },
          },
```

3. Replace the whole rescheduling block — from `const newStartTime = payload.startTime` through `data.endTime = newEndTime;` — with:

```ts
          const newStartTime = payload.startTime ? new Date(payload.startTime) : booking.startTime;

          // Same length as booked, so the amount already paid stays right.
          const terms = bookingTerms(booking.service, newStartTime, booking.units, {
            enforceUnitLimits: false,
          });

          if (
            booking.service.bookingMode === "SLOT" &&
            payload.endTime &&
            new Date(payload.endTime).getTime() !== terms.endTime.getTime()
          ) {
            const slotMinutes = (new Date(payload.endTime).getTime() - newStartTime.getTime()) / (60 * 1000);
            throw new BadRequestException(
              `Slot duration (${slotMinutes} min) does not match service duration (${booking.service.duration} min)`,
            );
          }

          const overlapping = await tx.booking.findFirst({
            where: blockingBookingsWhere(
              booking.service,
              { start: newStartTime, end: terms.endTime },
              { excludeId: booking.id },
            ),
            select: { id: true },
          });
          if (overlapping) {
            throw new ConflictException(
              booking.service.bookingMode === "SLOT"
                ? "This time slot is already booked. Please select a different slot."
                : "Those dates are already booked. Pick different dates.",
            );
          }

          data.startTime = newStartTime;
          data.endTime = terms.endTime;
```

- [ ] **Step 4: Run the tests**

Run: `yarn test "src/app/api/bookings/\[slug\]/route.test.ts" && yarn typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/bookings/[slug]/route.ts" "src/app/api/bookings/[slug]/route.test.ts"
git commit -m "feat: reschedule stays and rentals with their length kept"
```

---

### Task 8: Public service endpoint and client data layer

**Files:**
- Modify: `src/backend/services/catalog/index.ts`
- Modify: `src/app/api/public/services/[slug]/route.ts`
- Modify: `src/app/api/public/services/[slug]/route.test.ts`
- Modify: `src/server/book.ts`
- Modify: `types/index.ts`
- Modify: `src/utils/api.ts`
- Modify: `src/hooks/queries/use-public-service.ts`

**Interfaces:**
- Consumes: `availabilityService.getNights / getPickupTimes` (Task 5), `nightsWindow`, `monthStart` (Task 2).
- Produces:
  - `catalogService.getPublicService(slug, query: { date: string; from?: string; to?: string; units?: number })`
  - `PublicServiceDto` gains `bookingMode`, `checkInTime`, `checkOutTime`, `minUnits`, `maxUnits`, `nights: NightDto[]`; `NightDto = { date: string; isAvailable: boolean }`
  - `PublicBookingInput` = `{ serviceSlug; startTime; endTime?; units?; clientName; clientEmail?; clientPhone?; notes? }`
  - `api.public.nights(slug, from, to)`, `api.public.pickups(slug, date, units)`
  - `publicServiceKeys.service(slug)`, `.nights(slug, from, to)`, `.pickups(slug, date, units)`
  - `usePublicNightsQuery(slug, window: { from; to }, initial?: PublicServiceDto)`, `usePublicPickupsQuery(slug, date, units, initial?: PublicServiceDto)`

- [ ] **Step 1: Write the failing route tests**

In `src/app/api/public/services/[slug]/route.test.ts`, extend the availability mock to
`availabilityService: { getAvailableSlots: vi.fn(), getNights: vi.fn(), getPickupTimes: vi.fn() }`,
import `BadRequestException` from `@/utils/exceptions`, and add:

```ts
const STAY = {
  id: "svc_4b", slug: "lekki-4b", name: "Lekki 2-bed 4B", description: null, image: null,
  price: 85000, duration: 1440, isActive: true, businessId: "biz_1",
  bookingMode: "NIGHTLY", checkInTime: "14:00", checkOutTime: "12:00", minUnits: 1, maxUnits: 30,
  business: { name: "Lekki Stays", currency: "NGN" },
};
const CAR = { ...STAY, id: "svc_car", slug: "prado", bookingMode: "DAILY", checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 14 };
const url = (query: string) => new Request(`https://x/api/public/services/x?${query}`);
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("GET /api/public/services/[slug] for stays and rentals", () => {
  it("returns a stay's nights for the requested window", async () => {
    mockedDb.service.findFirst.mockResolvedValue(STAY);
    mockedAvail.getNights.mockResolvedValue([{ date: "2026-10-01", isAvailable: true }]);
    const res = await GET(url("from=2026-10-01&to=2026-12-01"), params("lekki-4b"));
    expect(res.status).toBe(200);
    expect(mockedAvail.getNights).toHaveBeenCalledWith({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-12-01" });
    const json = await res.json();
    expect(json.data.bookingMode).toBe("NIGHTLY");
    expect(json.data.nights).toEqual([{ date: "2026-10-01", isAvailable: true }]);
    expect(json.data.slots).toEqual([]);
  });

  it("defaults a stay to the date's month window", async () => {
    mockedDb.service.findFirst.mockResolvedValue(STAY);
    mockedAvail.getNights.mockResolvedValue([]);
    await GET(url("date=2026-10-17"), params("lekki-4b"));
    expect(mockedAvail.getNights).toHaveBeenCalledWith({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-12-01" });
  });

  it("returns a car's pickup times for the date and days", async () => {
    mockedDb.service.findFirst.mockResolvedValue(CAR);
    mockedAvail.getPickupTimes.mockResolvedValue([
      { startTime: new Date("2026-10-05T10:00:00Z"), endTime: new Date("2026-10-07T10:00:00Z"), isAvailable: true },
    ]);
    const res = await GET(url("date=2026-10-05&units=2"), params("prado"));
    expect(mockedAvail.getPickupTimes).toHaveBeenCalledWith({ serviceId: "svc_car", date: "2026-10-05", units: 2 });
    expect((await res.json()).data.slots).toHaveLength(1);
  });

  it("rejects a nights window longer than 125 days", async () => {
    const res = await GET(url("from=2026-10-01&to=2027-03-01"), params("lekki-4b"));
    expect(res.status).toBe(422);
  });

  it("rejects units that aren't a whole number from 1 to 90", async () => {
    const res = await GET(url("date=2026-10-05&units=0"), params("prado"));
    expect(res.status).toBe(422);
  });

  it("returns 400 when availability rejects the request", async () => {
    mockedDb.service.findFirst.mockResolvedValue(CAR);
    mockedAvail.getPickupTimes.mockRejectedValue(new BadRequestException("Book between 1 and 14 days."));
    const res = await GET(url("date=2026-10-05&units=20"), params("prado"));
    expect(res.status).toBe(400);
  });
});
```

Also add `bookingMode: "SLOT", checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 30` to the existing "Haircut" fixture.

- [ ] **Step 2: Run to see it fail**

Run: `yarn test "src/app/api/public/services"`
Expected: FAIL.

- [ ] **Step 3: Update the types**

In `types/index.ts`, add `BookingMode` to the `@prisma/client` import, then:

```ts
export interface NightDto {
  date: string; // YYYY-MM-DD
  isAvailable: boolean;
}

export interface PublicServiceDto {
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
  price: string;
  duration: number;
  currency: string;
  businessName: string;
  bookingMode: BookingMode;
  checkInTime: string | null;
  checkOutTime: string | null;
  minUnits: number;
  maxUnits: number;
  /** SLOT: the day's slots. DAILY: pickup times. NIGHTLY: empty. */
  slots: TimeSlot[];
  /** NIGHTLY: the requested window's nights. Otherwise empty. */
  nights: NightDto[];
}

/** POST /api/public/bookings body. */
export interface PublicBookingInput {
  serviceSlug: string;
  startTime: string;
  /** Slot services only. */
  endTime?: string;
  /** Stays and rentals: nights or days. */
  units?: number;
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  notes?: string;
}
```

- [ ] **Step 4: Update the catalog**

Replace `src/backend/services/catalog/index.ts` with:

```ts
import type { PublicServiceDto } from "types";

import { availabilityService } from "@/backend/services/availability";
import { db } from "@/server/db";
import { monthStart, nightsWindow } from "@/utils/format";

export type PublicService = PublicServiceDto;

export type PublicServiceQuery = {
  /** SLOT: the day. DAILY: the pickup day. NIGHTLY: picks the default month. */
  date: string;
  /** NIGHTLY window, [from, to). */
  from?: string;
  to?: string;
  /** DAILY: rental length; defaults to the minimum. */
  units?: number;
};

const iso = (d: Date) => d.toISOString();

class CatalogService {
  /**
   * An active service with the availability its mode needs, or null when the
   * slug is unknown or the service is paused. Owner-only fields never leave
   * this function.
   */
  async getPublicService(slug: string, query: PublicServiceQuery): Promise<PublicService | null> {
    const service = await db.service.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true, slug: true, name: true, description: true, image: true, price: true, duration: true,
        businessId: true, bookingMode: true, checkInTime: true, checkOutTime: true, minUnits: true, maxUnits: true,
        business: { select: { name: true, currency: true } },
      },
    });
    if (!service) return null;

    const base = {
      slug: service.slug,
      name: service.name,
      description: service.description,
      image: service.image,
      price: service.price.toString(),
      duration: service.duration,
      currency: service.business.currency,
      businessName: service.business.name,
      bookingMode: service.bookingMode,
      checkInTime: service.checkInTime,
      checkOutTime: service.checkOutTime,
      minUnits: service.minUnits,
      maxUnits: service.maxUnits,
    };

    if (service.bookingMode === "NIGHTLY") {
      const window =
        query.from && query.to
          ? { from: query.from, to: query.to }
          : nightsWindow(monthStart(query.date), service.maxUnits);
      const nights = await availabilityService.getNights({ serviceId: service.id, ...window });
      return { ...base, slots: [], nights };
    }

    const slots =
      service.bookingMode === "DAILY"
        ? await availabilityService.getPickupTimes({
            serviceId: service.id,
            date: query.date,
            units: query.units ?? service.minUnits,
          })
        : await availabilityService.getAvailableSlots({
            businessId: service.businessId,
            serviceId: service.id,
            date: query.date,
          });

    return {
      ...base,
      slots: slots.map((s) => ({ startTime: iso(s.startTime), endTime: iso(s.endTime), isAvailable: s.isAvailable })),
      nights: [],
    };
  }
}

export const catalogService = new CatalogService();
```

- [ ] **Step 5: Update the route**

Replace the body of `GET` in `src/app/api/public/services/[slug]/route.ts`:

```ts
import { catalogService } from "@/backend/services/catalog";
import { HttpException } from "@/utils/exceptions";
import { daysBetween } from "@/utils/format";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WINDOW_DAYS = 125; // a month plus the longest stay (90 nights)

const unprocessable = (message: string) =>
  NextResponse.json({ status: 422, message }, { status: 422 });

/**
 * @description Public (unauthenticated) service details + availability.
 *              SLOT: ?date. NIGHTLY: ?from&to (nights in [from, to)).
 *              DAILY: ?date&units (pickup times). Used by the booking page.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const search = new URL(request.url).searchParams;
    const date = search.get("date");
    const from = search.get("from");
    const to = search.get("to");
    const unitsParam = search.get("units");

    for (const [name, value] of [["date", date], ["from", from], ["to", to]] as const) {
      if (value !== null && !DATE.test(value)) return unprocessable(`${name} must be in YYYY-MM-DD format`);
    }
    if ((from === null) !== (to === null)) return unprocessable("from and to go together");
    if (from && to) {
      const span = daysBetween(from, to);
      if (span < 1 || span > MAX_WINDOW_DAYS) {
        return unprocessable(`to must be 1 to ${MAX_WINDOW_DAYS} days after from`);
      }
    }
    let units: number | undefined;
    if (unitsParam !== null) {
      units = Number(unitsParam);
      if (!Number.isInteger(units) || units < 1 || units > 90) {
        return unprocessable("units must be a whole number from 1 to 90");
      }
    }

    const service = await catalogService.getPublicService(slug, {
      date: date ?? new Date().toISOString().split("T")[0]!,
      from: from ?? undefined,
      to: to ?? undefined,
      units,
    });
    if (!service) {
      return NextResponse.json({ status: 404, message: "Service not found" }, { status: 404 });
    }
    return NextResponse.json({ status: 200, message: "Service retrieved successfully", data: service });
  } catch (error: any) {
    if (error instanceof HttpException) {
      return NextResponse.json({ status: error.statusCode, message: error.message }, { status: error.statusCode });
    }
    console.error("[Public Service] Error:", error?.message ?? error);
    return NextResponse.json({ status: 500, message: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 6: Update the server loader**

In `src/server/book.ts`, change the first loader's body to `catalogService.getPublicService(slug, { date })`. Change `getBookingReceipt`'s select and return to carry the booking's times:

```ts
    select: {
      status: true,
      startTime: true,
      endTime: true,
      units: true,
      clientName: true,
      service: { select: { slug: true, name: true, bookingMode: true } },
      business: { select: { name: true } },
    },
```

```ts
  return {
    status: booking.status,
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
    units: booking.units,
    bookingMode: booking.service.bookingMode,
    clientName: booking.clientName,
    serviceSlug: booking.service.slug,
    serviceName: booking.service.name,
    businessName: booking.business.name,
  };
```

- [ ] **Step 7: Client API and hooks**

In `src/utils/api.ts`, inside `public: { … }` after `service`, add:

```ts
    nights: (slug: string, from: string, to: string) =>
      data<PublicServiceDto>(http.get(`/public/services/${encodeURIComponent(slug)}`, { params: { from, to } })),
    pickups: (slug: string, date: string, units: number) =>
      data<PublicServiceDto>(http.get(`/public/services/${encodeURIComponent(slug)}`, { params: { date, units } })),
```

Replace `src/hooks/queries/use-public-service.ts` with:

```ts
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PublicServiceDto } from "types";

import { api } from "@/utils/api";

export const publicServiceKeys = {
  all: ["public-service"] as const,
  /** Everything loaded for one service: invalidate this after a failed booking. */
  service: (slug: string) => [...publicServiceKeys.all, slug] as const,
  detail: (slug: string, date: string) => [...publicServiceKeys.service(slug), date] as const,
  nights: (slug: string, from: string, to: string) =>
    [...publicServiceKeys.service(slug), "nights", from, to] as const,
  pickups: (slug: string, date: string, units: number) =>
    [...publicServiceKeys.service(slug), "pickups", date, units] as const,
};

// Free time goes quickly; re-check each time it is shown.
const STALE_MS = 30 * 1000;

/**
 * A slot service and its slots for one day. `initial` is the server-rendered
 * day: it seeds only that date's query, and switching days keeps the
 * previous slots on screen until the new ones land.
 */
export function usePublicServiceQuery(
  slug: string,
  date: string,
  initial?: { date: string; data: PublicServiceDto },
) {
  return useQuery({
    queryKey: publicServiceKeys.detail(slug, date),
    queryFn: () => api.public.service(slug, date),
    initialData: initial?.date === date ? initial.data : undefined,
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
  });
}

/** A stay's nights over [from, to). `initial` seeds the server-rendered window. */
export function usePublicNightsQuery(
  slug: string,
  window: { from: string; to: string },
  initial?: PublicServiceDto,
) {
  return useQuery({
    queryKey: publicServiceKeys.nights(slug, window.from, window.to),
    queryFn: () => api.public.nights(slug, window.from, window.to),
    initialData: initial,
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
  });
}

/** A car's pickup times on a day for a rental of `units` days. */
export function usePublicPickupsQuery(slug: string, date: string, units: number, initial?: PublicServiceDto) {
  return useQuery({
    queryKey: publicServiceKeys.pickups(slug, date, units),
    queryFn: () => api.public.pickups(slug, date, units),
    initialData: initial,
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
  });
}
```

- [ ] **Step 8: Run tests and types**

Run: `yarn test "src/app/api/public" && yarn typecheck`
Expected: route tests PASS. `typecheck` will also flag `booking-page-client.tsx` and `done/page.tsx` where they build `PublicBookingInput` or read the receipt. Leave those for Task 12, but nothing outside `src/components/book/**` and `src/app/book/**` may error. If anything else does, fix it here.

- [ ] **Step 9: Commit**

```bash
git add src/backend/services/catalog "src/app/api/public/services" src/server/book.ts types/index.ts src/utils/api.ts src/hooks/queries/use-public-service.ts
git commit -m "feat: public service endpoint serves nights and pickup times"
```

---

### Task 9: Payment webhook, emails, reminders and calendar

**Files:**
- Modify: `src/app/api/webhooks/paystack/route.ts`
- Modify: `src/app/api/webhooks/paystack/route.test.ts`
- Modify: `src/backend/services/email/messages.tsx`
- Modify: `src/backend/services/email/messages.test.tsx`
- Modify: `src/app/api/cron/booking-reminders/route.ts`
- Modify: `src/app/api/bookings/[slug]/route.ts` (cancellation and reschedule emails)
- Modify: `src/backend/services/googleCalendar/index.ts` (event summary)

**Interfaces:**
- Consumes: `bookingWhen`, `bookingSpan`, `unitCount` (Task 2); `blockingBookingsWhere` (Task 4).
- Produces: `type BookingSpanInput = { bookingMode: BookingMode; endTime: Date; units: number }`, exported from `messages.tsx`. Every booking email builder takes an optional `span?: BookingSpanInput`; `bookingRescheduledEmail` also takes `previousSpan?: BookingSpanInput`.

- [ ] **Step 1: Email tests**

Add to `src/backend/services/email/messages.test.tsx` (it already has `origin` and the `rendered(message)` helper; add `bookingConfirmedEmail` to its import list):

```ts
  it("describes a stay in the confirmation email", async () => {
    const message = bookingConfirmedEmail({
      origin,
      to: "bisi@example.com",
      business: { name: "Lekki Stays" },
      serviceName: "Lekki 2-bed 4B",
      startTime: new Date("2026-10-02T14:00:00.000Z"),
      duration: 1440,
      amount: 255000,
      currency: "NGN",
      receiptUrl: null,
      span: { bookingMode: "NIGHTLY", endTime: new Date("2026-10-05T12:00:00.000Z"), units: 3 },
    });
    const { text } = await rendered(message);
    expect(text).toContain("Check-in Fri 2 Oct from 14:00 · Check-out Mon 5 Oct by 12:00 · 3 nights");
    expect(text).toContain("3 nights");
  });

  it("uses the short span in a stay's reminder subject", () => {
    const message = bookingReminderEmail({
      origin,
      to: "bisi@example.com",
      business: { name: "Lekki Stays" },
      serviceName: "Lekki 2-bed 4B",
      startTime: new Date("2026-10-02T14:00:00.000Z"),
      span: { bookingMode: "NIGHTLY", endTime: new Date("2026-10-05T12:00:00.000Z"), units: 3 },
    });
    expect(message.subject).toBe("Reminder: Lekki 2-bed 4B with Lekki Stays, 2–5 Oct · 3 nights");
  });
```

- [ ] **Step 2: Implement the email span**

In `src/backend/services/email/messages.tsx`:

```ts
import type { BookingMode } from "@prisma/client";

import { bookingSpan, bookingWhen, formatDuration, formatMoney, formatSlotMoment, unitCount } from "@/utils/format";
```

Below the existing `when` helper add:

```ts
/** A stay or rental's end and length; slot bookings leave it out. */
export interface BookingSpanInput {
  bookingMode: BookingMode;
  endTime: Date;
  units: number;
}

const times = (startTime: Date, span: BookingSpanInput) => ({
  bookingMode: span.bookingMode,
  startTime: startTime.toISOString(),
  endTime: span.endTime.toISOString(),
  units: span.units,
});
const isUnitSpan = (span?: BookingSpanInput): span is BookingSpanInput =>
  Boolean(span && span.bookingMode !== "SLOT");

/** The body's "when": full check-in/check-out or pickup/return wording for stays and rentals. */
const whenOf = (startTime: Date, span?: BookingSpanInput) =>
  isUnitSpan(span) ? bookingWhen(times(startTime, span)) : when(startTime);

/** The subject line's "when": compact for stays and rentals. */
const subjectWhen = (startTime: Date, span?: BookingSpanInput) =>
  isUnitSpan(span) ? bookingSpan(times(startTime, span)) : when(startTime);
```

Then in each booking builder:
- `newBookingEmail`: add `span?: BookingSpanInput;` to the input; subject uses `subjectWhen(input.startTime, input.span)`; `when={whenOf(input.startTime, input.span)}`.
- `bookingConfirmedEmail`: add `span?`; `when={whenOf(input.startTime, input.span)}`; `duration={isUnitSpan(input.span) ? unitCount(input.span.bookingMode, input.span.units) : formatDuration(input.duration)}`.
- `bookingReminderEmail`: add `span?`; `const at = subjectWhen(input.startTime, input.span);` for the subject and `when={whenOf(input.startTime, input.span)}` for the body.
- `bookingRescheduledEmail`: add `span?` and `previousSpan?`; subject uses `subjectWhen(input.newStartTime, input.span)`; `previousWhen={whenOf(input.previousStartTime, input.previousSpan)}`; `when={whenOf(input.newStartTime, input.span)}`.
- `bookingCancelledEmail`: add `span?`; `when={whenOf(input.startTime, input.span)}`.

- [ ] **Step 3: Webhook tests**

In `src/app/api/webhooks/paystack/route.test.ts`:

1. Add `findFirst: vi.fn()` to the mocked `booking` and `sendBookingCancellationEmail: vi.fn().mockResolvedValue({ success: true })` to the mocked email service.
2. Extend `BOOKING` with `serviceId: "svc_1", units: 1, amount: 50, holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),` and change its `service` to `{ id: "svc_1", name: "Haircut", slug: "haircut", duration: 45, price: 50, bookingMode: "SLOT" }`.
3. In `beforeEach`, add `mockedDb.booking.findFirst.mockResolvedValue(null);`.
4. Add:

```ts
  it("puts the service on the receipt as a line, quantity = units", async () => {
    mockedDb.booking.findUnique.mockResolvedValue({
      ...BOOKING,
      units: 3,
      service: { ...BOOKING.service, name: "Lekki 2-bed 4B", bookingMode: "NIGHTLY", price: 50 / 3 },
    });
    await POST(buildRequest(buildEvent()));
    expect(mockedReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        services: [
          expect.objectContaining({ serviceId: "svc_1", quantity: 3, total: 50 }),
        ],
      }),
    );
  });

  it("confirms a late payment when the time is still free", async () => {
    mockedDb.booking.findUnique.mockResolvedValue({ ...BOOKING, holdExpiresAt: new Date(Date.now() - 60 * 1000) });
    await POST(buildRequest(buildEvent()));
    expect(mockedDb.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CONFIRMED" } }),
    );
  });

  it("cancels a late payment whose time was resold, and tells the owner to refund", async () => {
    mockedDb.booking.findUnique.mockResolvedValue({ ...BOOKING, holdExpiresAt: new Date(Date.now() - 60 * 1000) });
    mockedDb.booking.findFirst.mockResolvedValue({ id: "bkg_other" });

    const response = await POST(buildRequest(buildEvent()));

    expect(response.status).toBe(200);
    expect(mockedDb.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELLED" } }),
    );
    expect(mockedDb.payment.create).toHaveBeenCalled();
    expect(mockedReceipt.create).not.toHaveBeenCalled();
    expect(mockedEmail.sendBookingConfirmationEmail).not.toHaveBeenCalled();
    expect(mockedEmail.sendBookingCancellationEmail).toHaveBeenCalled();
    expect(mockedNotifier.notify).toHaveBeenCalledWith(
      BOOKING.businessId,
      expect.stringContaining("Refund it from your Paystack dashboard"),
    );
  });
```

Run: `yarn test src/app/api/webhooks/paystack` — Expected: FAIL.

- [ ] **Step 4: Implement the webhook changes**

In `src/app/api/webhooks/paystack/route.ts`:

1. Imports:

```ts
import { blockingBookingsWhere } from "@/backend/services/booking/conflicts";
import { bookingWhen } from "@/utils/format";
```

2. In the booking `select`, add `serviceId: true, units: true, amount: true, holdExpiresAt: true,`, and change `service` to `service: { select: { id: true, name: true, slug: true, duration: true, price: true, bookingMode: true } },`.

3. After the `booking.status !== "PENDING"` guard, add the late-payment branch:

```ts
  const span = { bookingMode: booking.service.bookingMode, endTime: booking.endTime, units: booking.units };
  const whenText = bookingWhen({
    bookingMode: booking.service.bookingMode,
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
    units: booking.units,
  });
  const paymentData = {
    businessId,
    amount: amount / 100,
    method: "PAYSTACK" as const,
    reference,
    clientName:
      booking.clientName || [customer.first_name, customer.last_name].filter(Boolean).join(" ") || undefined,
    clientEmail: booking.clientEmail || customer.email,
    clientPhone: booking.clientPhone,
  };

  // The hold ran out before Paystack told us. Confirm only if nobody has
  // taken the time since; otherwise cancel, keep the payment on record, and
  // tell the owner to refund it.
  const now = new Date();
  if (booking.holdExpiresAt && booking.holdExpiresAt <= now) {
    const taken = await db.booking.findFirst({
      where: blockingBookingsWhere(
        { id: booking.serviceId, businessId: booking.businessId, bookingMode: booking.service.bookingMode },
        { start: booking.startTime, end: booking.endTime },
        { now, excludeId: booking.id },
      ),
      select: { id: true },
    });
    if (taken) {
      await db.$transaction(async (tx) => {
        await tx.booking.update({ where: { id: bookingId }, data: { status: "CANCELLED" } });
        await tx.payment.create({ data: paymentData });
      });
      console.warn(`[Paystack Webhook] Late payment for resold time; booking ${bookingId} cancelled. Ref: ${reference}`);
      try {
        await ownerNotifier.notify(
          businessId,
          `⚠️ ${booking.clientName ?? "A customer"} paid ${formatMoney(amount / 100, booking.business.currency)} for ${booking.service.name} (${whenText}), but that time was already booked. The booking is cancelled. Refund it from your Paystack dashboard.`,
        );
      } catch (err) {
        console.warn("[Paystack Webhook] Owner notification failed:", err);
      }
      const lateEmail = booking.clientEmail ?? customer.email;
      if (lateEmail) {
        try {
          await emailService.sendBookingCancellationEmail({
            to: lateEmail,
            business: booking.business,
            serviceName: booking.service.name,
            serviceSlug: booking.service.slug,
            startTime: booking.startTime,
            span,
          });
        } catch (err) {
          console.warn("[Paystack Webhook] Cancellation email failed:", err);
        }
      }
      return;
    }
  }
```

4. In the existing confirm transaction, replace the inline `tx.payment.create({ data: { … } })` with `tx.payment.create({ data: paymentData })`.

5. In `receiptService.create({ … })`, add:

```ts
      services: [
        {
          serviceId: booking.serviceId,
          description: booking.service.name,
          quantity: booking.units,
          unitPrice: amount / 100 / booking.units,
          total: amount / 100,
        },
      ],
```

6. Replace the owner notification's `when` (`booking.startTime.toLocaleString(…)`) with `whenText`: `` `💰 ${…} paid ${…} for ${booking.service.name} (${whenText}).` ``

7. Pass `span` to `sendBookingConfirmationEmail({ … , span })` and `sendNewBookingEmail({ … , span })`.

- [ ] **Step 5: Reminders, reschedule/cancel emails, calendar**

- `src/app/api/cron/booking-reminders/route.ts`: add `endTime: true, units: true` to the booking select and `bookingMode: true` to its `service` select, and pass `span: { bookingMode: booking.service.bookingMode, endTime: booking.endTime, units: booking.units }` to `sendBookingReminderEmail`. Also add `AND: [activeBookingWhere()]` to its `where` if it doesn't already restrict status to CONFIRMED, so an expired hold gets no reminder. Import `activeBookingWhere` from `@/backend/services/booking/conflicts`.
- `src/app/api/bookings/[slug]/route.ts`: pass `span: { bookingMode: booking.service.bookingMode, endTime: updatedBooking.endTime, units: updatedBooking.units }` to both `sendBookingCancellationEmail` calls (PUT and DELETE; in DELETE use that handler's booking variable and add `bookingMode: true` to its service select). Pass `span` (new end) and `previousSpan: { bookingMode: booking.service.bookingMode, endTime: booking.endTime, units: booking.units }` to `sendBookingRescheduledEmail`.
- `src/backend/services/googleCalendar/index.ts`: widen `CalendarBookingFields` to include `units` as optional (`units?: number`) and `CalendarServiceFields` to include `bookingMode?: BookingMode`. In `eventPayload`, set:

```ts
      summary:
        service.bookingMode && service.bookingMode !== "SLOT" && booking.units
          ? `${service.name} — ${booking.clientName} (${unitCount(service.bookingMode, booking.units)})`
          : `${service.name} — ${booking.clientName}`,
```

(import `unitCount` from `@/utils/format`, `BookingMode` type from `@prisma/client`).

- [ ] **Step 6: Run the tests**

Run: `yarn test src/app/api src/backend/services/email src/backend/services/googleCalendar && yarn typecheck`
Expected: PASS. Existing reminder/reschedule tests that use `toHaveBeenCalledWith(expect.objectContaining(…))` keep passing because `span` is extra.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/webhooks/paystack src/backend/services/email src/app/api/cron/booking-reminders "src/app/api/bookings/[slug]/route.ts" src/backend/services/googleCalendar/index.ts
git commit -m "feat: receipts, emails and calendar describe stays and rentals; late payments handled"
```

---

### Task 10: Today's bookings and chat labels

**Files:**
- Modify: `src/backend/services/dashboard/index.ts`
- Create: `src/backend/services/dashboard/index.test.ts`
- Modify: `types/index.ts` (`DashboardData.todayBookings`)
- Modify: `src/components/dashboard/dashboard-page-client.tsx`
- Modify: `src/backend/services/messaging/dispatch/index.ts`
- Modify: `src/backend/services/messaging/dispatch/index.test.ts`

**Interfaces:**
- Consumes: `activeBookingWhere` (Task 4); `todayEventLabel`, `TodayEventKind`, `unitCount`, `serviceLabel` (Task 2).
- Produces: `TodayBooking = { slug; kind: TodayEventKind; at: Date; startTime; endTime; units; status; clientName; serviceName }`; DTO with ISO strings.

- [ ] **Step 1: Write the failing dashboard test**

`src/backend/services/dashboard/index.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: { booking: { findMany: vi.fn() } } }));

import { db } from "@/server/db";

import { dashboardService } from "./index";

const mockedDb = db as any;

function today(time: string) {
  const d = new Date();
  const [h, m] = time.split(":").map(Number);
  d.setHours(h!, m!, 0, 0);
  return d;
}
const daysFromNow = (n: number, time: string) => {
  const d = today(time);
  d.setDate(d.getDate() + n);
  return d;
};

beforeEach(() => vi.clearAllMocks());

describe("dashboardService.todayBookings", () => {
  it("lists check-outs, check-ins, pickups and slots in time order", async () => {
    mockedDb.booking.findMany.mockResolvedValue([
      { slug: "stay-in", startTime: today("14:00"), endTime: daysFromNow(3, "12:00"), units: 3, status: "CONFIRMED", clientName: "Bisi Ojo", service: { name: "Lekki 4B", bookingMode: "NIGHTLY" } },
      { slug: "stay-out", startTime: daysFromNow(-2, "14:00"), endTime: today("12:00"), units: 2, status: "CONFIRMED", clientName: "Ada Okafor", service: { name: "Lekki 4B", bookingMode: "NIGHTLY" } },
      { slug: "car", startTime: today("10:00"), endTime: daysFromNow(2, "10:00"), units: 2, status: "CONFIRMED", clientName: "Chidi Eze", service: { name: "Toyota Prado", bookingMode: "DAILY" } },
      { slug: "braids", startTime: today("13:00"), endTime: today("17:00"), units: 1, status: "PENDING", clientName: "Funke Bello", service: { name: "Knotless braids", bookingMode: "SLOT" } },
    ]);

    const events = await dashboardService.todayBookings("biz_1");

    expect(events.map((e) => [e.slug, e.kind])).toEqual([
      ["car", "PICKUP"],
      ["stay-out", "CHECK_OUT"],
      ["braids", "SLOT"],
      ["stay-in", "CHECK_IN"],
    ]);
  });

  it("asks for bookings starting today, or stays and rentals ending today, that still hold time", async () => {
    mockedDb.booking.findMany.mockResolvedValue([]);
    await dashboardService.todayBookings("biz_1");
    const where = mockedDb.booking.findMany.mock.calls[0][0].where;
    expect(where.businessId).toBe("biz_1");
    expect(where.AND).toHaveLength(2);
  });
});
```

Run: `yarn test src/backend/services/dashboard` — Expected: FAIL.

- [ ] **Step 2: Implement `todayBookings`**

In `src/backend/services/dashboard/index.ts`:

```ts
import { activeBookingWhere } from "@/backend/services/booking/conflicts";
import type { TodayEventKind } from "@/utils/format";
```

Replace `TodayBooking` and `todayBookings`:

```ts
export type TodayBooking = {
  slug: string;
  /** What happens at `at`: a slot, or a stay/rental starting or ending. */
  kind: TodayEventKind;
  at: Date;
  startTime: Date;
  endTime: Date;
  units: number;
  status: "PENDING" | "CONFIRMED";
  clientName: string;
  serviceName: string;
};

const START_KIND = { SLOT: "SLOT", NIGHTLY: "CHECK_IN", DAILY: "PICKUP" } as const;
const END_KIND = { NIGHTLY: "CHECK_OUT", DAILY: "RETURN" } as const;
```

```ts
  /**
   * Today's moments, in time order: slot bookings, and stays and rentals
   * that start (check-in, pickup) or end (check-out, return) today.
   */
  async todayBookings(businessId: string): Promise<TodayBooking[]> {
    const start = startOfToday();
    const end = endOfToday();
    const bookings = await db.booking.findMany({
      where: {
        businessId,
        AND: [
          activeBookingWhere(),
          {
            OR: [
              { startTime: { gte: start, lt: end } },
              { endTime: { gte: start, lt: end }, service: { bookingMode: { not: "SLOT" } } },
            ],
          },
        ],
      },
      orderBy: { startTime: "asc" },
      take: 40,
      select: {
        slug: true, startTime: true, endTime: true, units: true, status: true, clientName: true,
        service: { select: { name: true, bookingMode: true } },
      },
    });

    const events: TodayBooking[] = [];
    for (const b of bookings) {
      const base = {
        slug: b.slug,
        startTime: b.startTime,
        endTime: b.endTime,
        units: b.units,
        status: b.status as TodayBooking["status"],
        clientName: b.clientName,
        serviceName: b.service.name,
      };
      const mode = b.service.bookingMode;
      if (b.startTime >= start && b.startTime < end) events.push({ ...base, kind: START_KIND[mode], at: b.startTime });
      if (mode !== "SLOT" && b.endTime >= start && b.endTime < end) events.push({ ...base, kind: END_KIND[mode], at: b.endTime });
    }
    return events.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 20);
  }
```

In `load()`, map `at: b.at.toISOString()` alongside `startTime`/`endTime`.

In `types/index.ts`, `DashboardData.todayBookings` items gain:

```ts
    kind: "SLOT" | "CHECK_IN" | "CHECK_OUT" | "PICKUP" | "RETURN";
    at: string;
    units: number;
```

- [ ] **Step 3: Dashboard UI**

In `src/components/dashboard/dashboard-page-client.tsx`'s today list: `key={`${booking.slug}-${booking.kind}`}`, the time shows `formatSlotTime(booking.at)`, and the muted line becomes:

```tsx
<p className="text-muted truncate text-sm">
  {booking.kind === "SLOT" ? booking.clientName : `${todayEventLabel(booking.kind)} · ${booking.clientName}`}
</p>
```

(import `todayEventLabel` from `@/utils/format`).

- [ ] **Step 4: Chat**

In `src/backend/services/messaging/dispatch/index.ts`:

- `listServiceOptions`: select `bookingMode: true` too and build `label: serviceLabel({ name: s.name, price: Number(s.price), duration: s.duration, currency, bookingMode: s.bookingMode })` (import `serviceLabel` from `@/utils/format`).
- `listTodayBookings`:

```ts
  async listTodayBookings(businessId: string): Promise<string> {
    const bookings = await dashboardService.todayBookings(businessId);
    if (bookings.length === 0) return "📅 No bookings today.";
    const lines = bookings.map((b) => {
      const time = b.at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      if (b.kind === "SLOT") return `• ${time} — ${b.serviceName} (${b.clientName})`;
      const length =
        b.kind === "CHECK_IN" ? `, ${unitCount("NIGHTLY", b.units)}` : b.kind === "PICKUP" ? `, ${unitCount("DAILY", b.units)}` : "";
      return `• ${time} — ${todayEventLabel(b.kind)}: ${b.serviceName} (${b.clientName}${length})`;
    });
    return `📅 Today's bookings:\n${lines.join("\n")}`;
  }
```

In `dispatch/index.test.ts`, "lists active services and builds a booking link": if it asserts the old `(60 min)` label, update the expectation to the `serviceLabel` form (`"… — NGN 5,000 (1 hr)"`) and add `bookingMode: "SLOT"` to the mocked service rows.

- [ ] **Step 5: Run the tests**

Run: `yarn test src/backend/services/dashboard src/backend/services/messaging && yarn typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/backend/services/dashboard src/backend/services/messaging types/index.ts src/components/dashboard/dashboard-page-client.tsx
git commit -m "feat: today's list shows check-ins, check-outs, pickups and returns"
```

---

### Task 11: Owner service form and service API

**Files:**
- Modify: `src/backend/validators/service.validator.ts`
- Create: `src/backend/validators/service.validator.test.ts`
- Modify: `src/backend/validators/service-form.validator.ts`
- Create: `src/backend/validators/service-form.validator.test.ts`
- Modify: `src/app/api/services/route.ts` (POST)
- Modify: `src/app/api/services/[slug]/route.ts` (PUT)
- Modify: `src/components/services/service-modal.tsx`
- Modify: `src/components/services/service-card.tsx`

**Interfaces:**
- Consumes: `activeBookingWhere` (Task 4); `unitNoun` (Task 2).
- Produces: `bookingSetupProblem(s): string | null` in `service.validator.ts`; `serviceFormSchema` output `{ bookingMode, name, price, description, duration, availableFrom, availableTo, checkInTime?, checkOutTime?, minUnits, maxUnits }`.

- [ ] **Step 1: Write the failing validator tests**

`src/backend/validators/service.validator.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { bookingSetupProblem } from "./service.validator";

describe("bookingSetupProblem", () => {
  it("accepts a slot service", () => {
    expect(bookingSetupProblem({ bookingMode: "SLOT", minUnits: 1, maxUnits: 30 })).toBeNull();
  });
  it("needs check-in and check-out times for a stay", () => {
    expect(bookingSetupProblem({ bookingMode: "NIGHTLY", checkInTime: "14:00", minUnits: 1, maxUnits: 30 })).toMatch(/required/);
  });
  it("needs check-out no later than check-in", () => {
    expect(
      bookingSetupProblem({ bookingMode: "NIGHTLY", checkInTime: "12:00", checkOutTime: "14:00", minUnits: 1, maxUnits: 30 }),
    ).toMatch(/no later than/);
    expect(
      bookingSetupProblem({ bookingMode: "NIGHTLY", checkInTime: "14:00", checkOutTime: "12:00", minUnits: 1, maxUnits: 30 }),
    ).toBeNull();
  });
  it("needs min no more than max", () => {
    expect(bookingSetupProblem({ bookingMode: "DAILY", minUnits: 5, maxUnits: 3 })).toMatch(/minUnits/);
  });
});
```

`src/backend/validators/service-form.validator.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { serviceFormSchema } from "./service-form.validator";

const base = {
  name: "Lekki 2-bed, Unit 4B",
  price: "85,000",
  duration: "",
  availableFrom: "08:00",
  availableTo: "18:00",
  checkInTime: "14:00",
  checkOutTime: "12:00",
  minUnits: "2",
  maxUnits: "30",
  description: "",
};

describe("serviceFormSchema", () => {
  it("turns a nightly form into a stay service", () => {
    const out = serviceFormSchema.parse({ ...base, bookingMode: "NIGHTLY" });
    expect(out).toMatchObject({
      bookingMode: "NIGHTLY", price: 85000, duration: 1440,
      checkInTime: "14:00", checkOutTime: "12:00", minUnits: 2, maxUnits: 30,
    });
  });
  it("needs a duration only for slot services", () => {
    expect(serviceFormSchema.safeParse({ ...base, bookingMode: "SLOT" }).success).toBe(false);
    const slot = serviceFormSchema.parse({ ...base, bookingMode: "SLOT", duration: "240" });
    expect(slot).toMatchObject({ duration: 240, minUnits: 1, maxUnits: 1 });
    expect(slot.checkInTime).toBeUndefined();
  });
  it("rejects a check-out later than check-in", () => {
    const result = serviceFormSchema.safeParse({ ...base, bookingMode: "NIGHTLY", checkOutTime: "15:00" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["checkOutTime"]);
  });
  it("rejects a minimum above the maximum", () => {
    const result = serviceFormSchema.safeParse({ ...base, bookingMode: "DAILY", minUnits: "5", maxUnits: "3" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["maxUnits"]);
  });
});
```

Run: `yarn test src/backend/validators` — Expected: FAIL.

- [ ] **Step 2: API validator**

In `src/backend/validators/service.validator.ts`, add to `serviceBaseSchema`:

```ts
  bookingMode: z
    .enum(["SLOT", "NIGHTLY", "DAILY"], "bookingMode must be one of: SLOT, NIGHTLY, DAILY")
    .default("SLOT"),
  checkInTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'checkInTime must be in HH:MM 24-hour format (e.g. "14:00")').nullable().optional(),
  checkOutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'checkOutTime must be in HH:MM 24-hour format (e.g. "12:00")').nullable().optional(),
  minUnits: z.coerce.number().int("minUnits must be an integer").min(1, "minUnits must be at least 1").max(90, "minUnits cannot exceed 90").default(1),
  maxUnits: z.coerce.number().int("maxUnits must be an integer").min(1, "maxUnits must be at least 1").max(90, "maxUnits cannot exceed 90").default(30),
```

and export:

```ts
/**
 * What's wrong with a service's booking setup, or null. Checked on the
 * merged values (an update may change only some of them).
 */
export function bookingSetupProblem(s: {
  bookingMode: "SLOT" | "NIGHTLY" | "DAILY";
  checkInTime?: string | null;
  checkOutTime?: string | null;
  minUnits: number;
  maxUnits: number;
}): string | null {
  if (s.minUnits > s.maxUnits) return "minUnits cannot be more than maxUnits";
  if (s.bookingMode === "NIGHTLY") {
    if (!s.checkInTime || !s.checkOutTime) return "checkInTime and checkOutTime are required for nightly booking";
    if (s.checkOutTime > s.checkInTime) {
      return "checkOutTime must be no later than checkInTime, so a guest can arrive the day another leaves";
    }
  }
  return null;
}
```

- [ ] **Step 3: Form validator**

Replace `src/backend/validators/service-form.validator.ts` with:

```ts
import { z } from "zod";

// Kept apart from service.validator.ts (the API's schemas): this one parses
// the owner's form strings into the numbers the API takes.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WHOLE = /^\d+$/;

export const BOOKING_MODES = ["SLOT", "NIGHTLY", "DAILY"] as const;
export type BookingModeValue = (typeof BOOKING_MODES)[number];

export const serviceFormSchema = z
  .object({
    bookingMode: z.enum(BOOKING_MODES),
    name: z
      .string()
      .trim()
      .min(1, "Enter a name, like “Knotless braids”")
      .max(255, "Keep the name under 255 characters"),
    price: z
      .string()
      .trim()
      .min(1, "Enter a price")
      .transform((v) => v.replace(/[,\s]/g, ""))
      .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), { message: "Enter an amount in naira, like 25000" })
      .transform(Number),
    // Each of these is checked below only for the modes that use it.
    duration: z.string().trim(),
    availableFrom: z.string().regex(HHMM, "Pick a start time"),
    availableTo: z.string().regex(HHMM, "Pick an end time"),
    checkInTime: z.string().regex(HHMM, "Pick a check-in time"),
    checkOutTime: z.string().regex(HHMM, "Pick a check-out time"),
    minUnits: z.string().trim(),
    maxUnits: z.string().trim(),
    description: z.string().trim().max(1000, "Keep the description under 1,000 characters"),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    if (v.bookingMode === "SLOT") {
      if (!WHOLE.test(v.duration) || Number(v.duration) < 5) issue("duration", "Enter whole minutes, at least 5");
      else if (Number(v.duration) > 24 * 60) issue("duration", "Keep it under 24 hours");
    }
    if (v.bookingMode !== "NIGHTLY" && v.availableFrom >= v.availableTo) {
      issue("availableTo", v.bookingMode === "DAILY" ? "Pickups must start before they end" : "Bookings must start before they end");
    }
    if (v.bookingMode === "NIGHTLY" && v.checkOutTime > v.checkInTime) {
      issue("checkOutTime", "Check-out must be no later than check-in, so the next guest can arrive that day");
    }
    if (v.bookingMode !== "SLOT") {
      const noun = v.bookingMode === "NIGHTLY" ? "nights" : "days";
      const valid = (s: string) => WHOLE.test(s) && Number(s) >= 1 && Number(s) <= 90;
      if (!valid(v.minUnits)) issue("minUnits", `Enter 1 to 90 ${noun}`);
      if (!valid(v.maxUnits)) issue("maxUnits", `Enter 1 to 90 ${noun}`);
      else if (valid(v.minUnits) && Number(v.minUnits) > Number(v.maxUnits)) {
        issue("maxUnits", "Must be at least the minimum");
      }
    }
  })
  .transform((v) => ({
    bookingMode: v.bookingMode,
    name: v.name,
    price: v.price,
    description: v.description,
    duration: v.bookingMode === "SLOT" ? Number(v.duration) : 24 * 60,
    availableFrom: v.availableFrom,
    availableTo: v.availableTo,
    checkInTime: v.bookingMode === "NIGHTLY" ? v.checkInTime : undefined,
    checkOutTime: v.bookingMode === "NIGHTLY" ? v.checkOutTime : undefined,
    minUnits: v.bookingMode === "SLOT" ? 1 : Number(v.minUnits),
    maxUnits: v.bookingMode === "SLOT" ? 1 : Number(v.maxUnits),
  }));

export type ServiceFormInput = z.input<typeof serviceFormSchema>;
export type ServiceFormOutput = z.output<typeof serviceFormSchema>;
```

- [ ] **Step 4: Persist the new fields**

`src/app/api/services/route.ts` POST: after reading `payload`, before the transaction:

```ts
      const problem = bookingSetupProblem(payload);
      if (problem) throw new BadRequestException(problem);
```

and in `data: Prisma.ServiceCreateInput` add:

```ts
          bookingMode: payload.bookingMode,
          checkInTime: payload.bookingMode === "NIGHTLY" ? payload.checkInTime : null,
          checkOutTime: payload.bookingMode === "NIGHTLY" ? payload.checkOutTime : null,
          minUnits: payload.minUnits,
          maxUnits: payload.maxUnits,
```

(import `bookingSetupProblem` from the validator and `BadRequestException` from `@/utils/exceptions` if not already imported).

`src/app/api/services/[slug]/route.ts` PUT: after the ownership check and before the transaction:

```ts
      const merged = {
        bookingMode: payload.bookingMode ?? service.bookingMode,
        checkInTime: payload.checkInTime !== undefined ? payload.checkInTime : service.checkInTime,
        checkOutTime: payload.checkOutTime !== undefined ? payload.checkOutTime : service.checkOutTime,
        minUnits: payload.minUnits ?? service.minUnits,
        maxUnits: payload.maxUnits ?? service.maxUnits,
      };
      const problem = bookingSetupProblem(merged);
      if (problem) throw new BadRequestException(problem);

      if (merged.bookingMode !== service.bookingMode) {
        const upcoming = await db.booking.count({
          where: { serviceId: service.id, endTime: { gt: new Date() }, AND: [activeBookingWhere()] },
        });
        if (upcoming > 0) throw new BadRequestException("Finish or cancel the upcoming bookings first.");
      }
```

and in the update `data` add:

```ts
        if (payload.bookingMode !== undefined) data.bookingMode = payload.bookingMode;
        if (payload.checkInTime !== undefined) data.checkInTime = payload.checkInTime;
        if (payload.checkOutTime !== undefined) data.checkOutTime = payload.checkOutTime;
        if (payload.minUnits !== undefined) data.minUnits = payload.minUnits;
        if (payload.maxUnits !== undefined) data.maxUnits = payload.maxUnits;
```

If `service` there is loaded with `include`, its scalar fields (`bookingMode`, `checkInTime`, …) are already present. If it uses `select`, add them.

- [ ] **Step 5: The form**

In `src/components/services/service-modal.tsx`:

1. Imports: add `Segmented` from `@/primitives`, and `type BookingModeValue` from the form validator.

2. `toFormValues`:

```ts
function toFormValues(service?: ServiceDto): ServiceFormInput {
  const mode = (service?.bookingMode ?? "SLOT") as BookingModeValue;
  return {
    bookingMode: mode,
    name: service?.name ?? "",
    price: service ? String(Number(service.price)) : "",
    duration: service && mode === "SLOT" ? String(service.duration) : "",
    availableFrom: service?.availableFrom ?? "09:00",
    availableTo: service?.availableTo ?? "17:00",
    checkInTime: service?.checkInTime ?? "14:00",
    checkOutTime: service?.checkOutTime ?? "12:00",
    minUnits: String(service?.minUnits ?? 1),
    maxUnits: String(service && mode !== "SLOT" ? service.maxUnits : 30),
    description: service?.description ?? "",
  };
}
```

3. Copy per mode, above the component:

```ts
const MODE_OPTIONS = [
  { value: "SLOT", label: "By time slot" },
  { value: "NIGHTLY", label: "By the night" },
  { value: "DAILY", label: "By the day" },
] as const;

const COPY: Record<BookingModeValue, { name: string; price: string; description: string }> = {
  SLOT: { name: "Knotless braids", price: "Price", description: "What's included, what to bring, how to prepare." },
  NIGHTLY: { name: "Lekki 2-bed, Unit 4B", price: "Price per night", description: "Rooms, amenities, house rules, how check-in works." },
  DAILY: { name: "Toyota Prado, LND-482-KJ", price: "Price per day", description: "Seats, fuel policy, where to pick up, what to bring." },
};
```

4. In the component: `const mode = watch("bookingMode");` and `const copy = COPY[mode];`.

5. As the form's first child, before the Name field:

```tsx
            <div className="grid gap-2">
              <p className="text-ink-2 text-sm font-semibold">How do customers book this?</p>
              <Controller
                control={control}
                name="bookingMode"
                render={({ field }) => (
                  <Segmented
                    label="How do customers book this?"
                    value={field.value}
                    options={MODE_OPTIONS}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
```

6. Name placeholder → `copy.name`; price label → `` `${copy.price} (${currency})` ``; description placeholder → `copy.description`.

7. Replace the Price+Duration row and the From/Until row with mode-specific blocks:

```tsx
            <div className="grid grid-cols-2 gap-4">
              <Field id="service-price" label={`${copy.price} (${currency})`} error={errors.price?.message}>
                <Input inputMode="decimal" placeholder={mode === "SLOT" ? "25000" : mode === "NIGHTLY" ? "85000" : "70000"} {...register("price")} />
              </Field>
              {mode === "SLOT" ? (
                <Field id="service-duration" label="Duration (min)" hint={errors.duration ? undefined : durationHint} error={errors.duration?.message}>
                  <Input inputMode="numeric" placeholder="240" {...register("duration")} />
                </Field>
              ) : (
                <div aria-hidden="true" />
              )}
            </div>

            {mode === "NIGHTLY" ? (
              <div className="grid grid-cols-2 gap-4">
                <Field id="service-check-in" label="Check-in from" error={errors.checkInTime?.message}>
                  <Controller control={control} name="checkInTime" render={({ field }) => (
                    <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} />
                  )} />
                </Field>
                <Field id="service-check-out" label="Check-out by" error={errors.checkOutTime?.message}>
                  <Controller control={control} name="checkOutTime" render={({ field }) => (
                    <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} />
                  )} />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Field id="service-from" label={mode === "DAILY" ? "Pickups from" : "Bookable from"} error={errors.availableFrom?.message}>
                  <Controller control={control} name="availableFrom" render={({ field }) => (
                    <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} />
                  )} />
                </Field>
                <Field id="service-to" label="Until" error={errors.availableTo?.message}>
                  <Controller control={control} name="availableTo" render={({ field }) => (
                    <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} />
                  )} />
                </Field>
              </div>
            )}

            {mode !== "SLOT" ? (
              <div className="grid grid-cols-2 gap-4">
                <Field id="service-min" label={`Minimum ${mode === "NIGHTLY" ? "nights" : "days"}`} error={errors.minUnits?.message}>
                  <Input inputMode="numeric" placeholder="1" {...register("minUnits")} />
                </Field>
                <Field id="service-max" label={`Maximum ${mode === "NIGHTLY" ? "nights" : "days"}`} error={errors.maxUnits?.message}>
                  <Input inputMode="numeric" placeholder="30" {...register("maxUnits")} />
                </Field>
              </div>
            ) : null}
```

8. The description under the title for a new service:

```tsx
              : "Each service gets its own booking link. Customers pick a time, dates or days there and pay."}
```

In `src/components/services/service-card.tsx` line 40, replace `{formatDuration(service.duration)}` with:

```tsx
{service.bookingMode === "SLOT" ? formatDuration(service.duration) : `per ${unitNoun(service.bookingMode, 1)}`}
```

(import `unitNoun` from `@/utils/format`).

- [ ] **Step 6: Run the tests**

Run: `yarn test src/backend/validators src/app/api/services && yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 7: Check it in the app**

Run `yarn dev`, sign in, open Services. Add one service of each kind and check:
- the fields switch with the mode;
- a nightly service with check-out 15:00 and check-in 14:00 is refused next to Check-out;
- each card shows "per night" or "per day".

- [ ] **Step 8: Commit**

```bash
git add src/backend/validators src/app/api/services src/components/services
git commit -m "feat: owners set services up to book by the night or by the day"
```

---

### Task 12: Customer booking page

**Files:**
- Create: `src/components/book/types.ts`
- Create: `src/components/book/slot-picker.tsx` (today's picker, moved)
- Create: `src/components/book/stay-calendar.tsx`
- Create: `src/components/book/stay-picker.tsx`
- Create: `src/components/book/day-count-stepper.tsx`
- Create: `src/components/book/rental-picker.tsx`
- Modify: `src/components/book/booking-page-client.tsx`
- Modify: `src/app/book/[slug]/page.tsx` (metadata wording)
- Modify: `src/app/book/[slug]/done/page.tsx`

**Interfaces:**
- Consumes: hooks from Task 8; `bookingWhen`, `bookingSpan`, `unitCount`, `unitNoun`, `eachDate`, `daysBetween`, `monthStart`, `addMonths`, `formatMonth`, `nightsWindow`, `addDays`, `formatLongDate` (Task 2).
- Produces: `type Selection = { startTime: string; endTime: string; units: number; when: string; short: string; total: number }`; pickers with props `{ slug, service, today, onChange: (s: Selection | null) => void }`; `StayCalendar` and `CalendarDay` (reused in Task 13).

- [ ] **Step 1: Shared selection type**

`src/components/book/types.ts`:

```ts
/** What a picker hands the booking page: one bookable choice. */
export type Selection = {
  startTime: string; // ISO
  endTime: string; // ISO
  units: number; // nights or days; 1 for a slot
  /** Full wording for the details step: bookingWhen. */
  when: string;
  /** Compact wording for the pay bar: bookingSpan. */
  short: string;
  /** price × units. */
  total: number;
};
```

- [ ] **Step 2: Move the slot picker**

`src/components/book/slot-picker.tsx`. This is the day strip, slot grid, loading and empty states from today's `booking-page-client.tsx`, unchanged in look:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { PublicServiceDto, TimeSlot } from "types";

import { usePublicServiceQuery } from "@/hooks/queries/use-public-service";
import { Notice } from "@/primitives";
import { addDays, bookingSpan, bookingWhen, formatLongDate } from "@/utils/format";

import { DayStrip } from "./day-strip";
import { SlotGrid, SlotGridSkeleton } from "./slot-grid";
import type { Selection } from "./types";

const DAYS_AHEAD = 14;

interface SlotPickerProps {
  slug: string;
  service: PublicServiceDto;
  today: string;
  onChange: (selection: Selection | null) => void;
}

/** Pick a day, then a free time. */
export function SlotPicker({ slug, service, today, onChange }: SlotPickerProps) {
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)), [today]);
  const query = usePublicServiceQuery(slug, date, { date: today, data: service });
  const slots = query.data?.slots ?? [];
  const hasOpenSlot = slots.some((s) => s.isAvailable && new Date(s.startTime).getTime() > Date.now());

  function choose(next: TimeSlot | null) {
    setSlot(next);
    if (!next) return onChange(null);
    const times = { bookingMode: "SLOT" as const, startTime: next.startTime, endTime: next.endTime, units: 1 };
    onChange({ ...times, when: bookingWhen(times), short: bookingSpan(times), total: Number(service.price) });
  }

  return (
    <>
      <h2 className="text-ink-2 text-sm font-semibold">Pick a day</h2>
      <div className="mt-2.5">
        <DayStrip
          days={days}
          selected={date}
          onSelect={(next) => {
            setDate(next);
            choose(null);
          }}
        />
      </div>

      <h2 className="text-ink-2 mt-6 text-sm font-semibold">Free times, {formatLongDate(date)}</h2>
      <div className="mt-2.5">
        {query.isError && !query.data ? (
          <Notice tone="danger">
            We couldn&apos;t load this day.{" "}
            <button type="button" className="cursor-pointer font-semibold underline" onClick={() => void query.refetch()}>
              Try again
            </button>
          </Notice>
        ) : query.isPending ? (
          <SlotGridSkeleton />
        ) : !hasOpenSlot && !query.isPlaceholderData ? (
          <Notice tone="neutral">No free times on this day. Try another day.</Notice>
        ) : (
          <SlotGrid slots={slots} selected={slot?.startTime ?? null} onSelect={choose} isStale={query.isPlaceholderData} />
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: The stay calendar**

`src/components/book/stay-calendar.tsx`:

```tsx
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";

import { cn } from "@/utils/cn";
import { formatLongDate, formatMonth } from "@/utils/format";

export type CalendarDay = {
  date: string; // YYYY-MM-DD
  state: "free" | "taken" | "past";
  selected: "start" | "end" | "between" | null;
  selectable: boolean;
};

interface StayCalendarProps {
  month: string; // YYYY-MM-01
  days: CalendarDay[]; // every day of `month`, in order
  onPick: (date: string) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  isStale: boolean;
}

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const NAV =
  "grid size-10 cursor-pointer place-items-center rounded-full text-ink transition-[background-color,scale] duration-200 ease-out-expo hover:bg-surface active:scale-96 disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent";

/**
 * A month of nights, Monday first. Booked nights are leaf grey and struck
 * through like taken slots; the stay is a green fill at each end with a mint
 * wash between (DESIGN.md slot language). Pure: the parent decides states.
 */
export function StayCalendar({ month, days, onPick, onPrev, onNext, isStale }: StayCalendarProps) {
  const lead = (new Date(`${month}T00:00:00.000Z`).getUTCDay() + 6) % 7;

  return (
    <div>
      <div className="flex items-center justify-between">
        <button type="button" className={NAV} aria-label="Previous month" disabled={!onPrev} onClick={onPrev ?? undefined}>
          <CaretLeft size={18} weight="bold" aria-hidden="true" />
        </button>
        <p className="font-display text-lg font-medium tracking-[-0.015em]" aria-live="polite">
          {formatMonth(month)}
        </p>
        <button type="button" className={NAV} aria-label="Next month" disabled={!onNext} onClick={onNext ?? undefined}>
          <CaretRight size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>

      <div
        className={cn("mt-3 grid grid-cols-7 gap-y-1 transition-opacity duration-200", isStale && "opacity-50")}
        aria-busy={isStale || undefined}
      >
        {WEEK.map((w) => (
          <span key={w} className="text-faint pb-1 text-center text-xs font-medium">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden="true" />
        ))}
        {days.map((day) => {
          const ends = day.selected === "start" || day.selected === "end";
          return (
            <button
              key={day.date}
              type="button"
              disabled={!day.selectable}
              aria-pressed={day.selected !== null}
              aria-label={`${formatLongDate(day.date)}${day.state === "taken" ? ", booked" : ""}`}
              onClick={() => onPick(day.date)}
              className={cn(
                "h-11 cursor-pointer text-[15px] font-semibold transition-[background-color,scale] duration-200 ease-out-expo active:scale-96 disabled:cursor-default disabled:active:scale-100",
                !day.selected && "rounded-[12px]",
                !day.selected && day.state === "free" && "text-ink hover:bg-surface",
                !day.selected && day.state !== "free" && "text-faint line-through",
                day.selected === "between" && "bg-accent-soft text-accent-ink",
                ends && "bg-accent text-on-accent rounded-[12px]",
              )}
            >
              {Number(day.date.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: The stay picker**

`src/components/book/stay-picker.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { PublicServiceDto } from "types";

import { usePublicNightsQuery } from "@/hooks/queries/use-public-service";
import { Notice } from "@/primitives";
import {
  addDays,
  addMonths,
  bookingSpan,
  bookingWhen,
  daysBetween,
  eachDate,
  monthStart,
  nightsWindow,
} from "@/utils/format";

import { StayCalendar, type CalendarDay } from "./stay-calendar";
import type { Selection } from "./types";

const HORIZON_DAYS = 180;

interface StayPickerProps {
  slug: string;
  service: PublicServiceDto;
  today: string;
  onChange: (selection: Selection | null) => void;
}

/** Tap check-in, then check-out. Nights are checked against both months shown and booked. */
export function StayPicker({ slug, service, today, onChange }: StayPickerProps) {
  const firstMonth = monthStart(today);
  const lastMonth = monthStart(addDays(today, HORIZON_DAYS));
  const [month, setMonth] = useState(firstMonth);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const initialFor = (m: string) => (m === firstMonth ? service : undefined);
  // What's on screen, and (while picking check-out) the month the stay starts
  // in, whose window reaches the longest stay.
  const view = usePublicNightsQuery(slug, nightsWindow(month, service.maxUnits), initialFor(month));
  const anchorMonth = checkIn ? monthStart(checkIn) : month;
  const anchor = usePublicNightsQuery(slug, nightsWindow(anchorMonth, service.maxUnits), initialFor(anchorMonth));

  const free = useMemo(
    () =>
      new Set(
        [...(view.data?.nights ?? []), ...(anchor.data?.nights ?? [])]
          .filter((n) => n.isAvailable)
          .map((n) => n.date),
      ),
    [view.data, anchor.data],
  );

  const min = service.minUnits;
  const max = service.maxUnits;
  const lengthRule = min === max ? `Stays here are exactly ${min} night${min === 1 ? "" : "s"}.` : `Stays here are ${min} to ${max} nights.`;

  function pick(date: string) {
    setProblem(null);
    const startingOver = !checkIn || checkOut !== null || date <= checkIn;
    if (startingOver) {
      if (!free.has(date)) {
        setProblem("That night is booked. Pick another check-in date.");
        return;
      }
      setCheckIn(date);
      setCheckOut(null);
      onChange(null);
      return;
    }
    const nights = daysBetween(checkIn, date);
    if (nights < min || nights > max) {
      setProblem(lengthRule);
      return;
    }
    if (eachDate(checkIn, date).some((night) => !free.has(night))) {
      setProblem("Some nights in those dates are booked. Pick different dates.");
      return;
    }
    setCheckOut(date);
    const times = {
      bookingMode: "NIGHTLY" as const,
      startTime: `${checkIn}T${service.checkInTime}:00.000Z`,
      endTime: `${date}T${service.checkOutTime}:00.000Z`,
      units: nights,
    };
    onChange({ ...times, when: bookingWhen(times), short: bookingSpan(times), total: Number(service.price) * nights });
  }

  const awaitingCheckOut = Boolean(checkIn && !checkOut);
  const days: CalendarDay[] = eachDate(month, addMonths(month, 1)).map((date) => {
    const past = date < today;
    const isFree = free.has(date);
    const selected =
      date === checkIn
        ? ("start" as const)
        : date === checkOut
          ? ("end" as const)
          : checkIn && checkOut && date > checkIn && date < checkOut
            ? ("between" as const)
            : null;
    return {
      date,
      state: past ? "past" : isFree ? "free" : "taken",
      selected,
      // A booked night can still be a check-out day: you leave that morning.
      selectable: !past && (isFree || (awaitingCheckOut && date > checkIn!)),
    };
  });

  return (
    <>
      <h2 className="text-ink-2 text-sm font-semibold">
        {awaitingCheckOut ? "Pick your check-out date" : "Pick your check-in date"}
      </h2>
      <div className="mt-2.5">
        {view.isError && !view.data ? (
          <Notice tone="danger">
            We couldn&apos;t load these dates.{" "}
            <button type="button" className="cursor-pointer font-semibold underline" onClick={() => void view.refetch()}>
              Try again
            </button>
          </Notice>
        ) : (
          <StayCalendar
            month={month}
            days={days}
            onPick={pick}
            onPrev={month > firstMonth ? () => setMonth(addMonths(month, -1)) : null}
            onNext={month < lastMonth ? () => setMonth(addMonths(month, 1)) : null}
            isStale={view.isPlaceholderData || view.isPending}
          />
        )}
      </div>
      <p className="text-muted mt-3 text-[13px]">{lengthRule}</p>
      {problem ? (
        <Notice tone="neutral" className="mt-3">
          {problem}
        </Notice>
      ) : null}
    </>
  );
}
```

- [ ] **Step 5: The day stepper and rental picker**

`src/components/book/day-count-stepper.tsx`:

```tsx
import { Minus, Plus } from "@phosphor-icons/react/dist/ssr";

const STEP =
  "bg-surface text-ink grid size-11 cursor-pointer place-items-center rounded-full transition-[background-color,scale] duration-200 ease-out-expo hover:bg-line active:scale-96 disabled:cursor-default disabled:text-faint disabled:hover:bg-surface disabled:active:scale-100";

interface DayCountStepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** "day" / "days" for a count. */
  noun: (n: number) => string;
}

/** − 2 days + . */
export function DayCountStepper({ value, min, max, onChange, noun }: DayCountStepperProps) {
  return (
    <div className="border-line flex items-center justify-between rounded-full border p-1.5">
      <button type="button" className={STEP} aria-label="One day fewer" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus size={18} weight="bold" aria-hidden="true" />
      </button>
      <p className="text-[17px] font-semibold" aria-live="polite">
        {value} {noun(value)}
      </p>
      <button type="button" className={STEP} aria-label="One day more" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={18} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}
```

(If `hover:bg-line` isn't a defined colour token in `globals.css`, use `hover:bg-surface` and drop the disabled override.)

`src/components/book/rental-picker.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { PublicServiceDto, TimeSlot } from "types";

import { usePublicPickupsQuery } from "@/hooks/queries/use-public-service";
import { Notice } from "@/primitives";
import { addDays, bookingSpan, bookingWhen, formatLongDate, unitNoun } from "@/utils/format";

import { DayCountStepper } from "./day-count-stepper";
import { DayStrip } from "./day-strip";
import { SlotGrid, SlotGridSkeleton } from "./slot-grid";
import type { Selection } from "./types";

const DAYS_AHEAD = 60;

interface RentalPickerProps {
  slug: string;
  service: PublicServiceDto;
  today: string;
  onChange: (selection: Selection | null) => void;
}

/** How many days, then a pickup day and time. The car is due back at the same time. */
export function RentalPicker({ slug, service, today, onChange }: RentalPickerProps) {
  const [units, setUnits] = useState(service.minUnits);
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)), [today]);
  const isInitial = date === today && units === service.minUnits;
  const query = usePublicPickupsQuery(slug, date, units, isInitial ? service : undefined);
  const slots = query.data?.slots ?? [];
  const hasOpen = slots.some((s) => s.isAvailable);

  function choose(next: TimeSlot | null, count = units) {
    setSlot(next);
    if (!next) return onChange(null);
    const times = { bookingMode: "DAILY" as const, startTime: next.startTime, endTime: next.endTime, units: count };
    onChange({ ...times, when: bookingWhen(times), short: bookingSpan(times), total: Number(service.price) * count });
  }

  return (
    <>
      <h2 className="text-ink-2 text-sm font-semibold">How many days?</h2>
      <div className="mt-2.5">
        <DayCountStepper
          value={units}
          min={service.minUnits}
          max={service.maxUnits}
          noun={(n) => unitNoun("DAILY", n)}
          onChange={(n) => {
            setUnits(n);
            choose(null, n);
          }}
        />
      </div>

      <h2 className="text-ink-2 mt-6 text-sm font-semibold">Pickup day</h2>
      <div className="mt-2.5">
        <DayStrip
          days={days}
          selected={date}
          onSelect={(next) => {
            setDate(next);
            choose(null);
          }}
        />
      </div>

      <h2 className="text-ink-2 mt-6 text-sm font-semibold">Pickup times, {formatLongDate(date)}</h2>
      <div className="mt-2.5">
        {query.isError && !query.data ? (
          <Notice tone="danger">
            We couldn&apos;t load this day.{" "}
            <button type="button" className="cursor-pointer font-semibold underline" onClick={() => void query.refetch()}>
              Try again
            </button>
          </Notice>
        ) : query.isPending ? (
          <SlotGridSkeleton />
        ) : !hasOpen && !query.isPlaceholderData ? (
          <Notice tone="neutral">No pickup times on this day. Try another day, or fewer days.</Notice>
        ) : (
          <SlotGrid slots={slots} selected={slot?.startTime ?? null} onSelect={(s) => choose(s)} isStale={query.isPlaceholderData} />
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 6: The booking page**

Replace `src/components/book/booking-page-client.tsx` with:

```tsx
"use client";

import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useState } from "react";
import type { PublicServiceDto } from "types";

import type { BookingDetailsFormSchema } from "@/backend/validators/booking.validator";
import { useCreatePublicBookingMutation } from "@/hooks/mutations/use-booking-mutations";
import { publicServiceKeys } from "@/hooks/queries/use-public-service";
import { Button, StatusPill, Wordmark } from "@/primitives";
import { errorMessage } from "@/utils/axios";
import { formatDuration, formatMoney, formatSlotTime, serviceLabel, unitCount, unitNoun } from "@/utils/format";

import { DetailsModal } from "./details-modal";
import { RentalPicker } from "./rental-picker";
import { SlotPicker } from "./slot-picker";
import { StayPicker } from "./stay-picker";
import type { Selection } from "./types";

interface BookingPageClientProps {
  slug: string;
  today: string;
  initialService: PublicServiceDto;
}

const PROMPT = {
  SLOT: "Pick a free time to continue",
  NIGHTLY: "Pick your check-in and check-out dates",
  DAILY: "Pick a pickup time to continue",
} as const;

const PANEL_LABEL = { SLOT: "Book a time", NIGHTLY: "Book your stay", DAILY: "Book your rental" } as const;

/**
 * The customer booking page: the service on the left, a picker for its
 * booking mode on the right, then details and Paystack. Owns the selection;
 * the pickers own their own day, dates or days.
 */
export function BookingPageClient({ slug, today, initialService: service }: BookingPageClientProps) {
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const booking = useCreatePublicBookingMutation();
  const mode = service.bookingMode;

  const price = formatMoney(service.price, service.currency);
  const payText = `Pay ${formatMoney(selection ? selection.total : service.price, service.currency)} with Paystack`;
  const buttonText = !selection
    ? "Continue"
    : mode === "SLOT"
      ? `Book ${formatSlotTime(selection.startTime)}`
      : `Book ${unitCount(mode, selection.units)}`;

  function submit(values: BookingDetailsFormSchema) {
    if (!selection) return;
    booking.mutate(
      {
        serviceSlug: slug,
        startTime: selection.startTime,
        ...(mode === "SLOT" ? { endTime: selection.endTime } : { units: selection.units }),
        clientName: values.clientName,
        clientEmail: values.clientEmail,
        clientPhone: values.clientPhone || undefined,
        notes: values.notes || undefined,
      },
      {
        // The time may have just gone; show availability as it is now.
        onError: () => void queryClient.invalidateQueries({ queryKey: publicServiceKeys.service(slug) }),
      },
    );
  }

  const picker = { slug, service, today, onChange: setSelection };

  return (
    <main className="bg-canvas text-ink min-h-dvh pb-32 lg:pb-16">
      <div className="max-w-page mx-auto px-4 md:px-8">
        <header className="flex h-16 items-center">
          <p className="text-muted truncate text-[15px] font-medium">{service.businessName}</p>
        </header>

        <div className="grid gap-8 pt-4 lg:grid-cols-[1fr_460px] lg:gap-16 lg:pt-12">
          {/* The service */}
          <section aria-labelledby="service-h" className="animate-rise">
            <h1
              id="service-h"
              className="font-display max-w-[18ch] text-[clamp(2.1rem,1.4rem+3vw,3.4rem)] leading-[1.04] font-[380] tracking-[-0.035em] text-balance"
            >
              {service.name}
            </h1>
            <div className="mt-4 flex flex-wrap gap-2">
              {mode === "SLOT" ? (
                <>
                  <StatusPill>{price}</StatusPill>
                  <StatusPill tone="muted">{formatDuration(service.duration)}</StatusPill>
                </>
              ) : (
                <>
                  <StatusPill>
                    {price} / {unitNoun(mode, 1)}
                  </StatusPill>
                  {mode === "NIGHTLY" ? (
                    <>
                      <StatusPill tone="muted">Check-in from {service.checkInTime}</StatusPill>
                      <StatusPill tone="muted">Check-out by {service.checkOutTime}</StatusPill>
                    </>
                  ) : service.minUnits > 1 ? (
                    <StatusPill tone="muted">Minimum {unitCount(mode, service.minUnits)}</StatusPill>
                  ) : null}
                </>
              )}
            </div>
            {service.description ? (
              <p className="text-muted mt-5 max-w-[52ch] text-pretty whitespace-pre-line">{service.description}</p>
            ) : null}
            {service.image ? (
              <div className="rounded-shot bg-surface outline-ink/5 relative mt-8 aspect-[4/3] max-w-[560px] overflow-hidden outline outline-1 -outline-offset-1">
                <Image
                  src={service.image}
                  alt={service.name}
                  fill
                  sizes="(min-width: 1024px) 560px, 100vw"
                  className="object-cover"
                  priority
                />
              </div>
            ) : null}
          </section>

          {/* Pick, then pay */}
          <section
            aria-label={PANEL_LABEL[mode]}
            className="rounded-panel lg:bg-canvas lg:shadow-float animate-rise-2 lg:self-start lg:px-6 lg:pt-6 lg:pb-6"
          >
            {mode === "NIGHTLY" ? (
              <StayPicker {...picker} />
            ) : mode === "DAILY" ? (
              <RentalPicker {...picker} />
            ) : (
              <SlotPicker {...picker} />
            )}

            {/* Phone: pinned to the bottom edge. Desktop: the card's foot. */}
            <div className="border-line bg-canvas/92 fixed inset-x-0 bottom-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:static lg:mt-6 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <p className="text-muted mb-2 text-center text-[13px] lg:hidden" aria-live="polite">
                {selection
                  ? `${selection.short} · ${formatMoney(selection.total, service.currency)}`
                  : PROMPT[mode]}
              </p>
              <Button
                size="lg"
                className="w-full"
                disabled={!selection}
                onClick={() => {
                  booking.reset();
                  setDetailsOpen(true);
                }}
              >
                {buttonText}
              </Button>
            </div>
          </section>
        </div>

        <footer className="text-faint mt-16 hidden items-center gap-2 text-[13px] lg:flex">
          Bookings by <Wordmark accent={false} className="text-faint text-[17px]" />
        </footer>
      </div>

      {selection ? (
        <DetailsModal
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          businessName={service.businessName}
          serviceText={serviceLabel(service)}
          slotText={selection.when}
          payText={payText}
          onSubmit={submit}
          isPending={booking.isPending || booking.isSuccess}
          error={booking.isError ? errorMessage(booking.error) : null}
        />
      ) : null}
    </main>
  );
}
```

- [ ] **Step 7: Done page and metadata**

In `src/app/book/[slug]/done/page.tsx`, import `bookingWhen` instead of `formatSlotMoment` and replace every `formatSlotMoment(booking.startTime)` with:

```ts
bookingWhen({ bookingMode: booking.bookingMode, startTime: booking.startTime, endTime: booking.endTime, units: booking.units })
```

In `src/app/book/[slug]/page.tsx`'s `generateMetadata`, change the description to say what to pick for the mode:

```ts
    const pick =
      service.bookingMode === "NIGHTLY" ? "Pick your dates" : service.bookingMode === "DAILY" ? "Pick your days" : "Pick a free time";
    return pageMetadata({
      title: `${service.name} · ${service.businessName}`,
      description: `Book ${serviceLabel(service)} with ${service.businessName}. ${pick} and pay with Paystack.`,
      path,
    });
```

- [ ] **Step 8: Types, lint, tests**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all PASS.

- [ ] **Step 9: Check it in the app at 375px**

Run `yarn dev`, set the browser to 375×812. With the services from Task 11 (Paystack test keys):
- **Slot service:** the page looks and behaves as before.
- **Nightly service:** pick a check-in, then a check-out two nights later. The pay bar shows "2–4 Oct · 2 nights · NGN 170,000". Book and pay with a test card.
- **Turnover:** reopen the nightly link. The two nights are struck through. The previous check-out date can be picked as a new check-in.
- **Across months:** pick a check-in in the last days of a month, go to the next month, and pick a check-out. It's accepted.
- **Daily service:** set 2 days, pick a day and a time. The summary shows the return at the same time two days later. Book it.
- **Overlap:** a second booking for the same car that overlaps the first can't be made. A booking for another car at the same time can.

- [ ] **Step 10: Commit**

```bash
git add src/components/book "src/app/book/[slug]"
git commit -m "feat: booking page picks nights for stays and days for rentals"
```

---

### Task 13: Owner reschedule and bookings list for stays and rentals

**Files:**
- Modify: `src/backend/validators/service.validator.ts` (`serviceDetailQueryValidatorSchema`)
- Modify: `src/app/api/services/[slug]/route.ts` (GET)
- Modify: `types/index.ts` (`ServiceDetail`, `BookingDto.service`)
- Modify: `src/backend/selects.ts` (`bookingListInclude`)
- Modify: `src/utils/api.ts` (`bookings.nights`, `bookings.pickups`, `bookings.reschedule`)
- Modify: `src/hooks/queries/use-bookings.ts`
- Modify: `src/components/bookings/reschedule-modal.tsx`
- Modify: `src/components/bookings/booking-row.tsx`

**Interfaces:**
- Consumes: `availabilityService.getNights / getPickupTimes` with `excludeBookingId` (Task 5); `StayCalendar`, `CalendarDay` (Task 12).
- Produces: owner `GET /api/services/[slug]?from&to&exclude` → `nights`; `?date&units&exclude` → pickup `slots`.

- [ ] **Step 1: Owner availability query**

`serviceDetailQueryValidatorSchema`:

```ts
export const serviceDetailQueryValidatorSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format").optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be in YYYY-MM-DD format").optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be in YYYY-MM-DD format").optional(),
    units: z.coerce.number().int().min(1).max(90).optional(),
    /** A booking's slug whose own time counts as free (it's the one being moved). */
    exclude: z.string().max(255).optional(),
  })
  .strict();
```

In the owner GET, replace the `availableSlots`/`slots` block with:

```ts
      const excluded = request.query?.exclude
        ? await db.booking.findFirst({
            where: { slug: request.query.exclude, serviceId: service.id },
            select: { id: true },
          })
        : null;
      const excludeBookingId = excluded?.id;

      let slots: TimeSlot[] = [];
      let nights: { date: string; isAvailable: boolean }[] = [];
      if (service.bookingMode === "NIGHTLY") {
        const from = request.query?.from ?? targetDate;
        const to = request.query?.to ?? addDays(from, 31);
        nights = await availabilityService.getNights({ serviceId: service.id, from, to, excludeBookingId });
      } else {
        const available =
          service.bookingMode === "DAILY"
            ? await availabilityService.getPickupTimes({
                serviceId: service.id,
                date: targetDate,
                units: request.query?.units ?? service.minUnits,
                excludeBookingId,
              })
            : await availabilityService.getAvailableSlots({
                businessId: service.businessId,
                serviceId: service.id,
                date: targetDate,
              });
        slots = available.map((slot) => ({
          startTime: slot.startTime.toISOString(),
          endTime: slot.endTime.toISOString(),
          isAvailable: slot.isAvailable,
        }));
      }
```

and return `data: { ...service, slots, nights }` (import `addDays` from `@/utils/format`). In `types/index.ts`, `ServiceDetail = Service & { slots: TimeSlot[]; nights: NightDto[] }`.

- [ ] **Step 2: Client API and hooks**

`src/utils/api.ts`, inside `bookings`:

```ts
    reschedule: (slug: string, startTime: string, endTime?: string) =>
      data<BookingDto>(
        http.put(`/bookings/${encodeURIComponent(slug)}`, endTime ? { startTime, endTime } : { startTime }),
      ),
    nights: (serviceSlug: string, from: string, to: string, exclude: string) =>
      data<ServiceDetail>(http.get(`/services/${encodeURIComponent(serviceSlug)}`, { params: { from, to, exclude } })),
    pickups: (serviceSlug: string, date: string, units: number, exclude: string) =>
      data<ServiceDetail>(http.get(`/services/${encodeURIComponent(serviceSlug)}`, { params: { date, units, exclude } })),
```

(match the existing `reschedule`'s return wrapper; read lines ~228–235 and keep its `data<…>` type).

`src/hooks/queries/use-bookings.ts`: add keys `nights: (slug, from, to, exclude) => [...bookingKeys.all, "nights", slug, from, to, exclude]` and `pickups: (slug, date, units, exclude) => [...bookingKeys.all, "pickups", slug, date, units, exclude]` to `bookingKeys`, and:

```ts
export function useServiceNightsQuery(serviceSlug: string, from: string, to: string, exclude: string, enabled: boolean) {
  return useQuery({
    queryKey: bookingKeys.nights(serviceSlug, from, to, exclude),
    queryFn: () => api.bookings.nights(serviceSlug, from, to, exclude),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

export function useServicePickupsQuery(serviceSlug: string, date: string, units: number, exclude: string, enabled: boolean) {
  return useQuery({
    queryKey: bookingKeys.pickups(serviceSlug, date, units, exclude),
    queryFn: () => api.bookings.pickups(serviceSlug, date, units, exclude),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}
```

Find where the reschedule mutation calls `api.bookings.reschedule(slug, slot.startTime, slot.endTime)` and pass `endTime` only for slot bookings: `api.bookings.reschedule(booking.slug, slot.startTime, booking.service.bookingMode === "SLOT" ? slot.endTime : undefined)` (adapt to the mutation's argument shape).

- [ ] **Step 3: Bookings carry their service's mode**

`src/backend/selects.ts` `bookingListInclude.service.select` gains `bookingMode: true`. `types/index.ts` `BookingDto.service` gains `bookingMode: BookingMode`.

`booking-row.tsx` line 42: show the span for stays and rentals:

```tsx
<p className="text-accent-ink text-[17px] font-semibold">
  {booking.service.bookingMode === "SLOT"
    ? formatSlotTime(booking.startTime)
    : bookingSpan({ bookingMode: booking.service.bookingMode, startTime: booking.startTime, endTime: booking.endTime, units: booking.units })}
</p>
```

(import `bookingSpan`).

- [ ] **Step 4: Reschedule modal by mode**

In `src/components/bookings/reschedule-modal.tsx`, keep the slot UI for `SLOT` and add the two unit-mode pickers in the same file, above `RescheduleModal`:

```tsx
/** Move a stay: pick a new check-in; the stay keeps its nights. */
function StayMove({ booking, onPick, picked }: { booking: BookingDto; onPick: (slot: TimeSlot | null) => void; picked: string | null }) {
  const today = todayIso();
  const [month, setMonth] = useState(monthStart(today));
  const window = { from: month, to: addMonths(month, 1 + Math.ceil(booking.units / 30)) };
  const nights = useServiceNightsQuery(booking.service.slug, window.from, window.to, booking.slug, true);
  const free = new Set((nights.data?.nights ?? []).filter((n) => n.isAvailable).map((n) => n.date));
  const checkInTime = booking.startTime.slice(11, 16);
  const checkOutTime = booking.endTime.slice(11, 16);
  const pickedCheckOut = picked ? addDays(picked, booking.units) : null;

  const days: CalendarDay[] = eachDate(month, addMonths(month, 1)).map((date) => {
    const past = date < today;
    const fits = eachDate(date, addDays(date, booking.units)).every((d) => free.has(d));
    return {
      date,
      state: past ? "past" : free.has(date) ? "free" : "taken",
      selected:
        date === picked ? "start" : date === pickedCheckOut ? "end" : picked && date > picked && date < pickedCheckOut! ? "between" : null,
      selectable: !past && fits,
    };
  });

  return (
    <StayCalendar
      month={month}
      days={days}
      isStale={nights.isPlaceholderData || nights.isPending}
      onPrev={month > monthStart(today) ? () => setMonth(addMonths(month, -1)) : null}
      onNext={() => setMonth(addMonths(month, 1))}
      onPick={(date) =>
        onPick({
          startTime: `${date}T${checkInTime}:00.000Z`,
          endTime: `${addDays(date, booking.units)}T${checkOutTime}:00.000Z`,
          isAvailable: true,
        })
      }
    />
  );
}

/** Move a rental: pick a new pickup day and time; the rental keeps its days. */
function RentalMove({ booking, onPick, picked }: { booking: BookingDto; onPick: (slot: TimeSlot | null) => void; picked: string | null }) {
  const today = todayIso();
  const days = useMemo(() => Array.from({ length: 60 }, (_, i) => addDays(today, i)), [today]);
  const [date, setDate] = useState(today);
  const pickups = useServicePickupsQuery(booking.service.slug, date, booking.units, booking.slug, true);
  return (
    <>
      <DayStrip days={days} selected={date} onSelect={(next) => { setDate(next); onPick(null); }} />
      <div className="mt-4">
        {pickups.isPending ? (
          <SlotGridSkeleton />
        ) : pickups.isError || !pickups.data ? (
          <Notice tone="danger">This day didn&apos;t load. Pick it again.</Notice>
        ) : (
          <SlotGrid slots={pickups.data.slots} selected={picked} onSelect={onPick} isStale={pickups.isPlaceholderData} />
        )}
      </div>
    </>
  );
}
```

In `RescheduleModal`, branch the body on `booking.service.bookingMode`:
- `SLOT`: the existing day strip + slot grid.
- `NIGHTLY`: `<StayMove booking={booking} picked={slot ? slot.startTime.slice(0, 10) : null} onPick={setSlot} />`, with the description "{name}, now {bookingSpan(...)}. Pick a new check-in; the stay keeps its {unitCount} nights."
- `DAILY`: `<RentalMove booking={booking} picked={slot?.startTime ?? null} onPick={setSlot} />`.

Button: `slot ? \`Move to ${bookingSpan({ bookingMode: booking.service.bookingMode, startTime: slot.startTime, endTime: slot.endTime, units: booking.units })}\` : "Pick a time"`.

Imports: `StayCalendar`, `CalendarDay` from `@/components/book/stay-calendar`; `useServiceNightsQuery`, `useServicePickupsQuery`; `addMonths`, `bookingSpan`, `eachDate`, `monthStart`, `unitCount` from `@/utils/format`.

- [ ] **Step 5: Verify**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: PASS.

Then in the app (375px), open Bookings:
- The stay and rental from Task 12 show "2–4 Oct · 2 nights" and "28–30 Sep · 2 days".
- Reschedule the stay one day later. The calendar lets you overlap its own current nights, and the email shows the new check-in and check-out.
- Reschedule the rental to another pickup time.

- [ ] **Step 6: Commit**

```bash
git add src/backend/validators/service.validator.ts "src/app/api/services/[slug]/route.ts" types/index.ts src/backend/selects.ts src/utils/api.ts src/hooks/queries/use-bookings.ts src/components/bookings
git commit -m "feat: owners see and move stays and rentals from the bookings page"
```

---

### Task 14: Whole-branch check

- [ ] **Step 1: Full checks**

Run: `yarn lint && yarn typecheck && yarn test && yarn build`
Expected: all pass.

- [ ] **Step 2: Chat check**

With a linked WhatsApp or Instagram test identity (or the engine tests' harness):
- Reply **3**: services show "/ night", "/ day" and "(4 hr)" labels.
- Reply **5** on a day with a check-in, a check-out and a pickup: each line is labelled.

- [ ] **Step 3: Hold expiry check**

Start a booking on the nightly link and abandon checkout. Confirm the nights show as booked. Then age the hold, either by waiting 30 minutes or with `UPDATE "Booking" SET "holdExpiresAt" = now() - interval '1 minute' WHERE slug = '<slug>';`, reload, and confirm the nights are free again.

- [ ] **Step 4: Update PRODUCT.md**

In `PRODUCT.md` → Capabilities and Constraints, add:

```
- Booking modes per service: by time slot (default), by the night (shortlets: check-in/check-out times, min/max nights, priced per night) and by the day (self-drive: 24-hour days from a chosen pickup time, priced per day). Each apartment or car is its own service with its own calendar; stays and rentals never block other units or the owner's slot bookings. Unpaid bookings hold their time for 30 minutes.
```

In "Does NOT exist yet", replace "deposit-gated bookings" with "caution fees / security deposits, iCal sync with Airbnb or Booking.com, guest count or ID capture, pickup and drop-off locations".

- [ ] **Step 5: Commit**

```bash
git add PRODUCT.md
git commit -m "docs: record booking modes in the product brief"
```

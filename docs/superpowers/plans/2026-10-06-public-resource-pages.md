# Public Resource Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every customer-facing record a public page with its own link-preview card: `/services/<slug>`, `/invoices/<publicId>`, `/receipts/<publicId>`, `/bookings/<publicId>` (plus `calendar.ics`), and hand those links out everywhere Sara sends links today.

**Architecture:** A new `src/app/(public)/` route group sits beside the owner app's `(app)` group; the middleware stops gating anything below the owner list paths. Invoices, receipts and bookings get a random `publicId` (Prisma `nanoid(16)`), and all absolute links are built in `src/server/share.ts` from client-safe paths in `src/utils/public-links.ts`. Each page reads one `cache()`d loader that its metadata and `opengraph-image` share; display rules live in pure `src/utils/*` modules so they are unit-tested without a browser or a database. The old `/i` and `/r` routes and their HMAC key signer are deleted.

**Tech Stack:** Next.js 15 App Router, React 19 server components, Prisma 6.19 (PostgreSQL 16), Tailwind CSS v4 tokens, `next/og` (Satori) + `sharp`, react-email, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-06-public-resource-pages-design.md`

## Global Constraints

- Style only with Tailwind utilities on the tokens in `src/styles/globals.css`; compose with `cn()` from `@/utils/cn`; no CSS modules, stylesheets or inline `style` (OG cards excepted: Satori has no stylesheet, values come from `OG` in `src/server/og.tsx`).
- WhatsApp green (`bg-accent`) is a fill with `text-on-accent`; green text or icons on white use `text-accent-ink`.
- No em dash (`—`) or en dash (`–`) in any new user-visible string; at most one `·` per line; money via `formatMoney()` ("NGN 25,000").
- Booking and slot times are Lagos wall-clock written as UTC: format with the `timeZone: "UTC"` helpers in `src/utils/format.ts` (24-hour "14:00"); compare start times with `wallClockNow()` from `src/backend/services/booking/clock.ts`; `holdExpiresAt`, `createdAt` and `Date.now()` are real instants. Spec examples like "2:00 pm" are illustrative; the app's format is "14:00".
- Read env only through `env` from `src/env.js`; tests mock `@/env` (and `@/server/db`; there is no database in the dev sandbox).
- No public loader selects a phone number or an email address.
- The four public pages export `dynamic = "force-dynamic"`.
- Light only; motion is the existing `animate-rise*` classes only.
- Commit messages: Conventional Commits, and never a "Co-Authored-By: Claude" (or similar) trailer (`CLAUDE.md`).
- `docs/` is in `.gitignore`; plan and spec files are committed with `git add -f`, code is not affected.
- Verify pages with `npx next build --no-lint` (the full `yarn build` fails on pre-existing lint) and lint only touched files with `npx eslint <files>`.
- Work on a feature branch, e.g. `git switch -c feat/public-resource-pages`.

## Review Focus

1. A booking whose service was later paused or renamed: the booking page must still load (the loader must not filter on `isActive`). Pinned in Task 6 (`getPublicBooking` `where` is exactly `{ publicId }`).
2. A pending booking created before holds existed (`holdExpiresAt` null) must read "released"/"Expired", never "held" forever with a spinner. Pinned in Task 6 (`bookingView`).
3. A business with no address (or blank parts like `state: " "`): no "Where" row, no `LOCATION` line in the calendar file, never a dangling ", ". Pinned in Task 6 (loader join + `bookingIcs`).
4. Long or non-ASCII names with commas and semicolons ("Tolú's Hair, Lekki; VI") in the calendar file must be escaped and folded at 75 octets so Apple and Google Calendar import it. Pinned in Task 6 (`bookingIcs`).
5. A stay or rental whose min and max length are equal must read "3 nights", never "3 to 3 nights". Pinned in Task 4 (`serviceTerms`).

## Refinements of the spec (intentional)

- `ServicePage` carries `businessName` but not the business's city: no surface in the spec shows it.
- `PublicBooking` is flat (`businessName`, `businessAddress`) and has no check-in/check-out fields: a stay's `startTime`/`endTime` already are the check-in and check-out moments.
- A pending booking whose hold ran out wears the pill "Expired" (`bookingPill`), not `BOOKING_STATUS`'s "Awaiting payment", which would contradict its "the time was released" line.
- `/book/[slug]`'s card reads `getServicePage` (no slot computation) instead of `getPublicService`; same data, same null cases.
- Path helpers live in client-safe `src/utils/public-links.ts`; `src/server/share.ts` re-exports them and adds the absolute builders, so owner rows (client components) can build links without importing server env.

---

### Task 1: Middleware gates only the owner list paths

The owner lists stay at `/invoices`, `/bookings`, `/receipts`, `/services`; everything below them becomes customer-facing. This task also proves Next accepts a `(public)` route beside an `(app)` page of the same first segment, before anything depends on it.

**Files:**
- Modify: `src/middleware.ts` (the `config` export at the end of the file)
- Test: `src/middleware.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `config.matcher` without `/:path*` on bookings, invoices, receipts, services. Later tasks rely on `/invoices/<id>`, `/receipts/<id>`, `/bookings/<id>`, `/bookings/<id>/calendar.ics` and `/services/<slug>` never reaching the middleware.

- [ ] **Step 1: Write the failing test**

Add to `src/middleware.test.ts`. Change the import line `import { middleware } from "./middleware";` to import `config` too, add the testing import at the top with the other imports, and append the new `describe` block at the end of the file:

```ts
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
```

```ts
import { config, middleware } from "./middleware";
```

```ts
describe("middleware matcher", () => {
  it.each([
    "/invoices",
    "/bookings",
    "/receipts",
    "/services",
    "/dashboard",
    "/settings",
    "/onboarding",
  ])("gates the owner page %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each([
    "/invoices/Xk39fjQ2aB7mN0pR",
    "/receipts/b7T0qLm2Vn9cZ4wE",
    "/bookings/Pq8sN1xV0kL3mA6t",
    "/bookings/Pq8sN1xV0kL3mA6t/calendar.ics",
    "/services/acme-braids",
  ])("leaves the customer page %s alone", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/middleware.test.ts`
Expected: FAIL — the five "leaves the customer page … alone" cases fail (`expected true to be false`); the existing three tests and the "gates" cases pass.

- [ ] **Step 3: Narrow the matcher**

Replace the `config` export at the end of `src/middleware.ts` with:

```ts
export const config = {
  matcher: [
    "/dashboard/:path*",
    // The owner's lists only. Below them (/invoices/<id>, /services/<slug>,
    // ...) are the customers' public pages, which never need a session.
    "/bookings",
    "/invoices",
    "/receipts",
    "/services",
    "/settings/:path*",
    "/onboarding",
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/middleware.test.ts`
Expected: PASS (all tests, including the existing bot-card and sign-in redirect tests).

- [ ] **Step 5: Prove the route tree builds**

Create a throwaway probe `src/app/(public)/invoices/[publicId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";

export default function Probe() {
  notFound();
}
```

Run: `npx next build --no-lint`
Expected: build succeeds; the route table lists both `○ /invoices` (or `ƒ /invoices`) and `ƒ /invoices/[publicId]`. If Next reports a conflict between `(app)` and `(public)`, stop and report it: the whole plan depends on this.

Then delete the probe (it is not committed):

```bash
rm -r "src/app/(public)"
```

- [ ] **Step 6: Commit**

```bash
git add src/middleware.ts src/middleware.test.ts
git commit -m "feat(middleware): gate only the owner list paths, not the pages below them"
```

---

### Task 2: Public ids, the receipt link column and link builders

**Files:**
- Modify: `prisma/schema.prisma` (models `Booking`, `Invoice`, `Receipt`, `Payment`)
- Create: `prisma/migrations/20261006120000_add_public_ids/migration.sql`
- Create: `src/utils/public-links.ts`
- Modify: `src/server/share.ts` (append link builders; the HMAC code stays until Task 3)
- Test: `src/utils/public-links.test.ts`, `src/server/share.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Prisma: `Invoice.publicId: string`, `Receipt.publicId: string`, `Booking.publicId: string` (unique, `@default(nanoid(16))`); `Payment.bookingId: string | null` with relations `Payment.booking` / `Booking.payments`.
  - `src/utils/public-links.ts`: `type PublicKind = "invoice" | "receipt" | "booking"`; `publicPath(kind: PublicKind, publicId: string): string` → `"/invoices/<id>"`; `servicePath(slug: string): string` → `"/services/<slug>"`. Client-safe (no env).
  - `src/server/share.ts`: re-exports the above, plus `publicLink(kind: PublicKind, publicId: string): string` and `serviceLink(slug: string): string`, absolute from `appBaseUrl()`.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/public-links.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { publicPath, servicePath } from "./public-links";

describe("public paths", () => {
  it("puts each record under the name the dashboard uses for it", () => {
    expect(publicPath("invoice", "Xk39fjQ2aB7mN0pR")).toBe("/invoices/Xk39fjQ2aB7mN0pR");
    expect(publicPath("receipt", "b7T0qLm2Vn9cZ4wE")).toBe("/receipts/b7T0qLm2Vn9cZ4wE");
    expect(publicPath("booking", "Pq8sN1xV0kL3mA6t")).toBe("/bookings/Pq8sN1xV0kL3mA6t");
    expect(servicePath("acme-braids")).toBe("/services/acme-braids");
  });

  it("keeps a path segment a single segment", () => {
    expect(publicPath("invoice", "a/b")).toBe("/invoices/a%2Fb");
    expect(servicePath("a b")).toBe("/services/a%20b");
  });
});
```

Append to `src/server/share.test.ts` (its `vi.mock("@/env")` already sets `NEXT_PUBLIC_APP_URL: "https://app.sara.ng"`). Change its import to:

```ts
import { isShareKey, publicLink, serviceLink, sharePath, shareUrl } from "./share";
```

and add:

```ts
describe("public links", () => {
  it("makes absolute links from the app's origin", () => {
    expect(publicLink("invoice", "Xk39fjQ2aB7mN0pR")).toBe(
      "https://app.sara.ng/invoices/Xk39fjQ2aB7mN0pR",
    );
    expect(publicLink("booking", "Pq8sN1xV0kL3mA6t")).toBe(
      "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",
    );
    expect(serviceLink("acme-braids")).toBe("https://app.sara.ng/services/acme-braids");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test src/utils/public-links.test.ts src/server/share.test.ts`
Expected: FAIL — `Failed to resolve import "./public-links"` and `publicLink is not a function`.

- [ ] **Step 3: Write the path module**

Create `src/utils/public-links.ts`:

```ts
/*
 * The paths of the customers' pages. Pure and client-safe: owner rows build
 * links from these and a base URL the server hands them; server/share.ts
 * builds the absolute links Sara sends. Invoices, receipts and bookings are
 * reached by their random publicId, never their guessable slug; services
 * are public by slug.
 */

export type PublicKind = "invoice" | "receipt" | "booking";

const SEGMENT: Record<PublicKind, string> = {
  invoice: "invoices",
  receipt: "receipts",
  booking: "bookings",
};

/** "/invoices/Xk39fjQ2aB7mN0pR". */
export function publicPath(kind: PublicKind, publicId: string) {
  return `/${SEGMENT[kind]}/${encodeURIComponent(publicId)}`;
}

/** "/services/acme-braids". */
export function servicePath(slug: string) {
  return `/services/${encodeURIComponent(slug)}`;
}
```

- [ ] **Step 4: Add the link builders to share.ts**

In `src/server/share.ts`, add this import below the existing `import { appBaseUrl } from "@/utils/url";`:

```ts
import { publicPath, servicePath, type PublicKind } from "@/utils/public-links";
```

and append to the end of the file:

```ts
export { publicPath, servicePath, type PublicKind };

/** The absolute link to a customer's invoice, receipt or booking page. */
export function publicLink(kind: PublicKind, publicId: string) {
  return `${appBaseUrl()}${publicPath(kind, publicId)}`;
}

/** The absolute link to a service's page. */
export function serviceLink(slug: string) {
  return `${appBaseUrl()}${servicePath(slug)}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test src/utils/public-links.test.ts src/server/share.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the columns to the schema**

In `prisma/schema.prisma`:

In `model Booking`, after `slug       String        @unique` add:

```prisma
  publicId   String        @unique @default(nanoid(16)) // the customer's link: /bookings/<publicId>
```

and after `invoice  Invoice?` (in its relations block) add:

```prisma
  payments Payment[]
```

In `model Invoice`, after `slug          String        @unique` add:

```prisma
  publicId      String        @unique @default(nanoid(16)) // the customer's link: /invoices/<publicId>
```

In `model Receipt`, after `slug          String  @unique` add:

```prisma
  publicId      String  @unique @default(nanoid(16)) // the customer's link: /receipts/<publicId>
```

In `model Payment`, after `invoiceId  String?` add:

```prisma
  bookingId  String? // set by the Paystack webhook, so a booking can find its receipt
```

after `invoice  Invoice? @relation(fields: [invoiceId], references: [id], onDelete: SetNull)` add:

```prisma
  booking  Booking? @relation(fields: [bookingId], references: [id], onDelete: SetNull)
```

and after `@@index([invoiceId])` add:

```prisma
  @@index([bookingId])
```

- [ ] **Step 7: Write the migration**

Prisma would add `publicId` as `NOT NULL` with no database default, which fails on tables that have rows, so this migration is written by hand: add nullable, backfill, then constrain.

Create `prisma/migrations/20261006120000_add_public_ids/migration.sql`:

```sql
-- Customer links by random id: /invoices/<publicId>, /receipts/<publicId>,
-- /bookings/<publicId>. New rows get nanoid(16) from Prisma Client; existing
-- rows get 16 URL-safe characters from gen_random_uuid() (built into
-- Postgres 13+, no extension needed).

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "publicId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "publicId" TEXT;
ALTER TABLE "Receipt" ADD COLUMN "publicId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "bookingId" TEXT;

-- Backfill
UPDATE "Booking" SET "publicId" = translate(substr(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), 1, 16), '+/', '-_');
UPDATE "Invoice" SET "publicId" = translate(substr(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), 1, 16), '+/', '-_');
UPDATE "Receipt" SET "publicId" = translate(substr(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), 1, 16), '+/', '-_');

-- Constrain
ALTER TABLE "Booking" ALTER COLUMN "publicId" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "publicId" SET NOT NULL;
ALTER TABLE "Receipt" ALTER COLUMN "publicId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Booking_publicId_key" ON "Booking"("publicId");
CREATE UNIQUE INDEX "Invoice_publicId_key" ON "Invoice"("publicId");
CREATE UNIQUE INDEX "Receipt_publicId_key" ON "Receipt"("publicId");
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 8: Validate the schema and check the migration's names**

Run:

```bash
npx prisma validate
npx prisma generate
git show HEAD:prisma/schema.prisma > "${TMPDIR:-/tmp}/schema.before.prisma"
npx prisma migrate diff --from-schema-datamodel "${TMPDIR:-/tmp}/schema.before.prisma" --to-schema-datamodel prisma/schema.prisma --script
```

Expected: validate prints "is valid"; generate succeeds; the diff script contains exactly the index and constraint names used above (`Booking_publicId_key`, `Invoice_publicId_key`, `Receipt_publicId_key`, `Payment_bookingId_idx`, `Payment_bookingId_fkey`). It will add the columns as `NOT NULL` in one step; that is the reason the migration is hand-written, not a mismatch. If any name differs, change the migration to Prisma's name.

If a database is reachable (`./start-database.sh` or `yarn docker:up`), also run `npx prisma migrate deploy` and `npx prisma migrate status` (expected: "Database schema is up to date"). Without one, say so in the task report.

- [ ] **Step 9: Typecheck and run the suite**

Run: `npx tsc --noEmit && yarn test`
Expected: both pass (nothing reads the new columns yet).

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261006120000_add_public_ids src/utils/public-links.ts src/utils/public-links.test.ts src/server/share.ts src/server/share.test.ts
git commit -m "feat: random public ids for invoices, receipts and bookings, and link builders"
```

---

### Task 3: Invoices and receipts move to `/invoices/<id>` and `/receipts/<id>`

Moves today's shared document page to the new URLs inside a shared `PublicPage` shell, switches every place that hands out invoice and receipt links, and deletes `/i`, `/r` and the HMAC signer.

**Files:**
- Create: `src/components/public/public-page.tsx`
- Create: `src/components/public/detail-skeleton.tsx`
- Modify: `src/components/documents/shared-document-page.tsx`
- Modify: `src/server/documents.ts`
- Modify: `src/utils/metadata.ts` (add `linkNotFoundMetadata`)
- Modify: `src/utils/shared-document.ts` (null branch uses it)
- Create: `src/app/(public)/invoices/[publicId]/{page,opengraph-image,not-found,loading}.tsx`
- Create: `src/app/(public)/receipts/[publicId]/{page,opengraph-image,not-found,loading}.tsx`
- Delete: `src/app/i/`, `src/app/r/`
- Modify: `src/server/share.ts` (drop HMAC)
- Modify: `src/app/api/invoices/route.ts:18,74-79`, `src/app/api/receipts/route.ts` (the `shareUrl` import and response), `src/app/api/webhooks/paystack/route.ts:15,317`, `src/backend/services/messaging/dispatch/index.ts:5,46,65`, `src/backend/services/email/documents.ts:3,30,51`
- Modify: email template preview props `src/backend/services/email/templates/{InvoiceEmail,ReceiptEmail,BookingConfirmedEmail}.tsx`
- Test: `src/server/documents.test.ts` (new), `src/server/share.test.ts`, `src/backend/services/messaging/dispatch/index.test.ts`, `src/backend/services/email/documents.test.ts`, `src/app/api/webhooks/paystack/route.test.ts`

**Interfaces:**
- Consumes: `publicPath`, `publicLink` (Task 2); `Invoice.publicId`, `Receipt.publicId` (Task 2).
- Produces:
  - `PublicPage({ businessName: string; credit: string; width?: "narrow" | "wide"; className?: string; children: ReactNode })` in `src/components/public/public-page.tsx`.
  - `PublicDetailSkeleton()` in `src/components/public/detail-skeleton.tsx`.
  - `getSharedInvoice(publicId: string): Promise<SharedDocument | null>`, `getSharedReceipt(publicId: string): Promise<SharedDocument | null>` (signatures change from `(slug, key)`).
  - `linkNotFoundMetadata(path: string): Metadata` in `src/utils/metadata.ts`.
  - `src/server/share.ts` exports only `publicPath`, `servicePath`, `PublicKind`, `publicLink`, `serviceLink`.

- [ ] **Step 1: Write the failing loader tests**

Create `src/server/documents.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: { invoice: { findUnique: vi.fn() }, receipt: { findUnique: vi.fn() } },
}));

import { db } from "@/server/db";

import { getSharedInvoice, getSharedReceipt } from "./documents";

const mockedDb = db as any;

const INVOICE_ROW = {
  invoiceNumber: "INV-1012",
  status: "PARTIALLY_PAID",
  clientName: "Ada Okafor",
  currency: "NGN",
  subtotal: 62000,
  taxAmount: 0,
  discount: 0,
  total: 62000,
  amountPaid: 20000,
  sentAt: new Date("2026-10-01T09:00:00.000Z"),
  createdAt: new Date("2026-09-30T09:00:00.000Z"),
  dueAt: new Date("2026-10-12T00:00:00.000Z"),
  notes: null,
  url: "https://cdn.test/INV-1012.pdf",
  business: { name: "Acme Salon" },
  services: [
    { description: "", quantity: 1, total: 62000, service: { name: "Knotless braids" } },
  ],
};

const RECEIPT_ROW = {
  receiptNumber: "RCP-1007",
  name: "Ada Okafor",
  currency: "NGN",
  subtotal: 15000,
  taxAmount: 0,
  discount: 0,
  total: 15000,
  amountPaid: 15000,
  paymentMethod: "BANK_TRANSFER",
  createdAt: new Date("2026-09-29T10:00:00.000Z"),
  notes: null,
  url: null,
  business: { name: "Acme Salon" },
  services: [],
};

const selectOf = (mock: any) => mock.mock.calls[0][0].select;

beforeEach(() => vi.clearAllMocks());

describe("getSharedInvoice", () => {
  it("looks the invoice up by its public id alone", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(INVOICE_ROW);
    const doc = await getSharedInvoice("Xk39fjQ2aB7mN0pR");
    expect(mockedDb.invoice.findUnique.mock.calls[0][0].where).toEqual({
      publicId: "Xk39fjQ2aB7mN0pR",
    });
    expect(doc).toMatchObject({
      kind: "invoice",
      number: "INV-1012",
      businessName: "Acme Salon",
      balance: 42000,
      lines: [{ description: "Knotless braids", quantity: 1, total: 62000 }],
    });
  });

  it("returns null for an unknown id", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(null);
    expect(await getSharedInvoice("nope")).toBeNull();
  });

  it("never reads the customer's contact details", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(null);
    await getSharedInvoice("x");
    const select = selectOf(mockedDb.invoice.findUnique);
    expect(select).not.toHaveProperty("clientEmail");
    expect(select).not.toHaveProperty("clientPhone");
    expect(select.business.select).toEqual({ name: true });
  });
});

describe("getSharedReceipt", () => {
  it("looks the receipt up by its public id alone", async () => {
    mockedDb.receipt.findUnique.mockResolvedValue(RECEIPT_ROW);
    const doc = await getSharedReceipt("b7T0qLm2Vn9cZ4wE");
    expect(mockedDb.receipt.findUnique.mock.calls[0][0].where).toEqual({
      publicId: "b7T0qLm2Vn9cZ4wE",
    });
    expect(doc).toMatchObject({
      kind: "receipt",
      number: "RCP-1007",
      paymentMethod: "Bank transfer",
      balance: 0,
    });
  });

  it("returns null for an unknown id and never reads contact details", async () => {
    mockedDb.receipt.findUnique.mockResolvedValue(null);
    expect(await getSharedReceipt("nope")).toBeNull();
    const select = selectOf(mockedDb.receipt.findUnique);
    expect(select).not.toHaveProperty("email");
    expect(select).not.toHaveProperty("phone");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test src/server/documents.test.ts`
Expected: FAIL — `getSharedInvoice("Xk39fjQ2aB7mN0pR")` returns null (it still checks an HMAC key against `undefined`) and `findUnique` is never called.

- [ ] **Step 3: Switch the loaders to publicId**

In `src/server/documents.ts`:
- Delete `import { isShareKey } from "@/server/share";`.
- Replace the `getSharedInvoice` header and lookup:

```ts
/** The invoice behind a customer's link, or null for an unknown id. */
export const getSharedInvoice = cache(
  async (publicId: string): Promise<SharedDocument | null> => {
    const invoice = await db.invoice.findUnique({
      where: { publicId },
```

- Replace the `getSharedReceipt` header and lookup:

```ts
/** The receipt behind a customer's link, or null for an unknown id. */
export const getSharedReceipt = cache(
  async (publicId: string): Promise<SharedDocument | null> => {
    const receipt = await db.receipt.findUnique({
      where: { publicId },
```

(Each function's `if (!isShareKey(...)) return null;` line is removed; the `select` blocks and the mapping stay exactly as they are.)

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test src/server/documents.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `linkNotFoundMetadata`**

Append to `src/utils/metadata.ts`:

```ts
/** The preview of a customer link that leads nowhere: mistyped, removed or out of date. */
export function linkNotFoundMetadata(path: string): Metadata {
  return pageMetadata({
    title: "Link not found · Sara",
    description:
      "This link is wrong or no longer works. Ask the business to send it again.",
    path,
    index: false,
  });
}
```

In `src/utils/shared-document.ts`, change the import to `import { linkNotFoundMetadata, pageMetadata } from "@/utils/metadata";` and replace the `if (!doc) { return pageMetadata({...}); }` block with:

```ts
  if (!doc) return linkNotFoundMetadata(path);
```

Run: `yarn test src/utils/shared-document.test.ts`
Expected: PASS (same text as before).

- [ ] **Step 6: Create the shared shell and skeleton**

Create `src/components/public/public-page.tsx`:

```tsx
import type { ReactNode } from "react";

import { Wordmark } from "@/primitives";
import { cn } from "@/utils/cn";

/**
 * The frame every customer page shares (services, invoices, receipts,
 * bookings): the business's name where a site name would be, the page, and
 * Sara's quiet single-ink credit at the foot, as on the booking page.
 * `narrow` reads like a document; `wide` is the booking page's width.
 */
export function PublicPage({
  businessName,
  credit,
  width = "narrow",
  className,
  children,
}: {
  businessName: string;
  /** "Bookings", "Invoices", "Receipts": the foot reads "<credit> by sara". */
  credit: string;
  width?: "narrow" | "wide";
  className?: string;
  children: ReactNode;
}) {
  return (
    <main className={cn("bg-canvas text-ink min-h-dvh pb-16", className)}>
      <div
        className={cn(
          "mx-auto px-4 md:px-8",
          width === "narrow" ? "max-w-[640px]" : "max-w-page",
        )}
      >
        <header className="flex h-16 items-center">
          <p className="text-muted truncate text-[15px] font-medium">
            {businessName}
          </p>
        </header>
        {children}
        <footer className="text-faint mt-16 flex items-center gap-2 text-[13px]">
          {credit} by{" "}
          <Wordmark accent={false} className="text-faint text-[17px]" />
        </footer>
      </div>
    </main>
  );
}
```

Create `src/components/public/detail-skeleton.tsx`:

```tsx
import { Skeleton } from "@/primitives";

/** A document or booking page's shape while it loads: pill, title, line, panel. */
export function PublicDetailSkeleton() {
  return (
    <main className="bg-canvas min-h-dvh" aria-busy="true" aria-label="Loading">
      <div className="mx-auto max-w-[640px] px-4 md:px-8">
        <div className="flex h-16 items-center">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="pt-4 lg:pt-12">
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="mt-4 h-11 w-4/5 max-w-[420px]" />
          <Skeleton className="mt-3 h-4 w-60" />
        </div>
        <Skeleton className="rounded-panel mt-8 h-[260px]" />
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Move the document page into the shell**

In `src/components/documents/shared-document-page.tsx`:
- Change the primitives import to `import { Button, StatusPill } from "@/primitives";` and add `import { PublicPage } from "@/components/public/public-page";`.
- Replace the outer `<main className="bg-canvas text-ink min-h-dvh pb-16">`, its inner `<div className="mx-auto max-w-[640px] px-4 md:px-8">`, the `<header>…</header>` and the `<footer>…</footer>` with the shell, so the returned JSX reads:

```tsx
  return (
    <PublicPage businessName={doc.businessName} credit={`${noun}s`}>
      <section
        aria-labelledby="document-h"
        className="animate-rise pt-4 lg:pt-12"
      >
        {/* unchanged: StatusPill, h1, the "For … · Issued …" line */}
      </section>

      {/* unchanged: the details <section>, the notes <p>, the Download PDF button */}
    </PublicPage>
  );
```

Keep every element between the old header and footer exactly as it is; only the wrappers, header and footer move into `PublicPage`. The component's doc comment stays.

- [ ] **Step 8: Create the invoice and receipt routes**

Create `src/app/(public)/invoices/[publicId]/page.tsx`:

```tsx
import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { SharedDocumentPage } from "@/components/documents/shared-document-page";
import { PublicError } from "@/components/public-error";
import { getSharedInvoice } from "@/server";
import { publicPath } from "@/utils/public-links";
import { documentMetadata } from "@/utils/shared-document";

type Params = { params: Promise<{ publicId: string }> };

// Payments land on the invoice after it's sent; always show it as it is now.
export const dynamic = "force-dynamic";

/** The invoice link Sara sends the customer (server/share.ts). Card: ./opengraph-image.tsx. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { publicId } = await params;
  const doc = await getSharedInvoice(publicId).catch(() => null);
  return documentMetadata(doc, publicPath("invoice", publicId));
}

export default async function SharedInvoicePage({ params }: Params) {
  const { publicId } = await params;

  let doc;
  try {
    doc = await getSharedInvoice(publicId);
  } catch (error) {
    console.error("[invoices] failed to load invoice:", error);
    return (
      <PublicError
        title="This invoice didn't load."
        body="Something went wrong on our side. Refresh the page to try again."
      />
    );
  }

  if (!doc) notFound();

  return <SharedDocumentPage doc={doc} />;
}
```

Create `src/app/(public)/invoices/[publicId]/opengraph-image.tsx`:

```tsx
import { getSharedInvoice } from "@/server";
import { documentCard, pageCard } from "@/server/og";
import { OG_SIZE } from "@/utils/metadata";

/*
 * An invoice link's share card: the document as the customer will find it.
 * An unknown id gets the site card, same as the page's 404.
 */

export const alt = "Invoice";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ publicId: string }> };

export default async function InvoiceOpenGraphImage({ params }: Params) {
  const { publicId } = await params;
  const doc = await getSharedInvoice(publicId).catch(() => null);
  return doc ? documentCard(doc) : pageCard("site");
}
```

Create `src/app/(public)/invoices/[publicId]/not-found.tsx`:

```tsx
import { PublicError } from "@/components/public-error";

export default function InvoiceNotFound() {
  return (
    <PublicError
      title="This link is wrong or no longer works."
      body="Ask the business to send the invoice again."
    />
  );
}
```

Create `src/app/(public)/invoices/[publicId]/loading.tsx`:

```tsx
import { PublicDetailSkeleton } from "@/components/public/detail-skeleton";

export default function InvoiceLoading() {
  return <PublicDetailSkeleton />;
}
```

Create the four receipt files under `src/app/(public)/receipts/[publicId]/` with the same code, changing: `getSharedInvoice` → `getSharedReceipt`; `publicPath("invoice", …)` → `publicPath("receipt", …)`; the comment "Payments land on the invoice after it's sent; always show it as it is now." → "Always show the receipt as it is now."; "[invoices] failed to load invoice:" → "[receipts] failed to load receipt:"; "This invoice didn't load." → "This receipt didn't load."; component names `SharedReceiptPage`, `ReceiptOpenGraphImage`, `ReceiptNotFound`, `ReceiptLoading`; `alt = "Receipt"`; the card comment "An invoice link's" → "A receipt link's"; not-found body "Ask the business to send the receipt again.".

- [ ] **Step 9: Switch every caller to publicLink**

`src/app/api/invoices/route.ts`: replace `import { shareUrl } from "@/server/share";` with `import { publicLink } from "@/server/share";` and the response data line with:

```ts
        data: { ...invoicedata, shareUrl: publicLink("invoice", invoicedata.publicId) },
```

`src/app/api/receipts/route.ts`: same import change, and:

```ts
          shareUrl: publicLink("receipt", receiptResult.publicId),
```

`src/app/api/webhooks/paystack/route.ts`: replace the `shareUrl` import with `import { publicLink } from "@/server/share";` and:

```ts
    receiptUrl = publicLink("receipt", receipt.publicId);
```

`src/backend/services/messaging/dispatch/index.ts`: replace the `shareUrl` import with `import { publicLink } from "@/server/share";` and the two links with:

```ts
      link: publicLink("invoice", invoice.publicId),
```

```ts
      link: publicLink("receipt", receipt.publicId),
```

`src/backend/services/email/documents.ts`: replace the import with `import { publicLink } from "@/server/share";`, the two urls with `url: publicLink("invoice", invoice.publicId),` and `url: publicLink("receipt", receipt.publicId),`, and in the file comment replace "linking the document's share page (server/share.ts)" with "linking the document's page (server/share.ts)".

- [ ] **Step 10: Update the caller tests**

`src/backend/services/messaging/dispatch/index.test.ts`: add `publicId: "Xk39fjQ2aB7mN0pR"` to the `invoiceService.create` resolved value and `publicId: "b7T0qLm2Vn9cZ4wE"` to the `receiptService.create` one; replace the two link assertions with:

```ts
    expect(result.link).toBe("https://app.sara.ng/invoices/Xk39fjQ2aB7mN0pR");
```

```ts
    expect(result.link).toBe("https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE");
```

`src/backend/services/email/documents.test.ts`: add `publicId: "Xk39fjQ2aB7mN0pR",` to the `invoice` fixture and `publicId: "b7T0qLm2Vn9cZ4wE",` to the `receipt` fixture; replace the invoice url regex `/^https:\/\/app\.sara\.ng\/i\/acme-inv-1012\/[\w-]{16}$/` with `/^https:\/\/app\.sara\.ng\/invoices\/Xk39fjQ2aB7mN0pR$/` and the receipt one `/\/r\/acme-rcp-1007\/[\w-]{16}$/` with `/\/receipts\/b7T0qLm2Vn9cZ4wE$/`.

`src/app/api/webhooks/paystack/route.test.ts`: change the receipt mock to `create: vi.fn().mockResolvedValue({ slug: "acme-rcp-1001", publicId: "b7T0qLm2Vn9cZ4wE", url: "https://cdn.test/r.pdf" }),`; replace `receiptUrl: expect.stringMatching(/\/r\/acme-rcp-1001\/[\w-]{16}$/),` with `receiptUrl: expect.stringMatching(/\/receipts\/b7T0qLm2Vn9cZ4wE$/),` and the notifier regex with `expect.stringMatching(/\nReceipt: https?:\/\/\S+\/receipts\/b7T0qLm2Vn9cZ4wE$/),`.

Opaque example URLs in other tests move to the new shape for consistency (behaviour unchanged): in `src/backend/services/email/messages.test.tsx` replace both occurrences of `https://app.sara.ng/i/acme-inv-1012/key` with `https://app.sara.ng/invoices/Xk39fjQ2aB7mN0pR` and `https://app.sara.ng/r/acme-rcp-1007/key` with `https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE`; in `src/backend/services/email/index.test.ts` replace both `https://app.sara.ng/r/acme-rcp-1001/key` with `https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE`; in `src/utils/shared-document.test.ts` replace `"/i/acme-inv-1012/key"` with `"/invoices/Xk39fjQ2aB7mN0pR"`, `"https://app.sara.ng/i/acme-inv-1012/key"` with `"https://app.sara.ng/invoices/Xk39fjQ2aB7mN0pR"`, `"/r/acme-rcp-1007/key"` with `"/receipts/b7T0qLm2Vn9cZ4wE"` and `"/i/nope"` with `"/invoices/nope"`.

Email preview props: in `InvoiceEmail.tsx` set `url: "https://sara.app/invoices/Xk39fjQ2aB7mN0pR",`; in `ReceiptEmail.tsx` set `url: "https://sara.app/receipts/b7T0qLm2Vn9cZ4wE",`; in `BookingConfirmedEmail.tsx` set `receiptUrl: "https://sara.app/receipts/b7T0qLm2Vn9cZ4wE",`.

- [ ] **Step 11: Delete `/i`, `/r` and the HMAC signer**

```bash
git rm -r src/app/i src/app/r
```

Replace the whole of `src/server/share.ts` with:

```ts
import { publicPath, servicePath, type PublicKind } from "@/utils/public-links";
import { appBaseUrl } from "@/utils/url";

/*
 * The absolute links Sara hands out: chat replies, emails, API responses.
 * Invoices, receipts and bookings are reached by their random publicId
 * (prisma/schema.prisma), never their guessable slug; services are public by
 * slug. Paths alone, for client code, live in utils/public-links.ts.
 */

export { publicPath, servicePath, type PublicKind };

/** "https://app.sara.ng/invoices/Xk39fjQ2aB7mN0pR". */
export function publicLink(kind: PublicKind, publicId: string) {
  return `${appBaseUrl()}${publicPath(kind, publicId)}`;
}

/** "https://app.sara.ng/services/acme-braids". */
export function serviceLink(slug: string) {
  return `${appBaseUrl()}${servicePath(slug)}`;
}
```

Replace the whole of `src/server/share.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://app.sara.ng" },
}));

import { publicLink, serviceLink } from "./share";

describe("public links", () => {
  it("makes absolute links from the app's origin", () => {
    expect(publicLink("invoice", "Xk39fjQ2aB7mN0pR")).toBe(
      "https://app.sara.ng/invoices/Xk39fjQ2aB7mN0pR",
    );
    expect(publicLink("receipt", "b7T0qLm2Vn9cZ4wE")).toBe(
      "https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE",
    );
    expect(publicLink("booking", "Pq8sN1xV0kL3mA6t")).toBe(
      "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",
    );
    expect(serviceLink("acme-braids")).toBe("https://app.sara.ng/services/acme-braids");
  });
});
```

- [ ] **Step 12: Check nothing still points at the old routes**

Run:

```bash
grep -rn "isShareKey\|sharePath\|shareUrl(" src
grep -rn '"/i/\|"/r/\|`/i/\|`/r/\|/i/\[slug\]\|/r/\[slug\]' src
```

Expected: no output from either (the API response field `shareUrl:` and `type SharedLink = { shareUrl: string }` are object keys, not calls, and do not match).

- [ ] **Step 13: Typecheck, test, build**

Run: `npx tsc --noEmit && yarn test && npx next build --no-lint`
Expected: all pass; the route table shows `ƒ /invoices/[publicId]`, `ƒ /receipts/[publicId]` and their `opengraph-image` routes, and no `/i/[slug]/[key]` or `/r/[slug]/[key]`.

Run: `npx eslint src/components/public src/components/documents/shared-document-page.tsx "src/app/(public)" src/server/documents.ts src/server/share.ts src/utils/metadata.ts src/utils/shared-document.ts`
Expected: no errors.

- [ ] **Step 14: Commit**

```bash
git add -A src/components/public src/components/documents/shared-document-page.tsx src/server src/utils/metadata.ts src/utils/shared-document.ts src/utils/shared-document.test.ts "src/app/(public)" src/app/api src/backend/services/messaging/dispatch src/backend/services/email
git status --short   # the src/app/i and src/app/r deletions are already staged by `git rm`
git commit -m "feat: invoice and receipt pages at /invoices/<id> and /receipts/<id>; drop /i and /r"
```

---

### Task 4: Service page data

**Files:**
- Modify: `src/utils/format.ts` (export `shortDay` and `dayMonth`; Task 6 and 7 use them)
- Create: `src/utils/service-page.ts`
- Create: `src/server/service-page.ts`
- Modify: `src/server/index.ts`
- Test: `src/utils/service-page.test.ts`, `src/server/service-page.test.ts`

**Interfaces:**
- Consumes: `servicePath` (Task 2), `linkNotFoundMetadata` (Task 3).
- Produces (`src/utils/service-page.ts`):
  - `type ServiceSummary = { slug: string; name: string; image: string | null; price: string; duration: number; bookingMode: BookingMode }`
  - `type ServicePage = ServiceSummary & { description: string | null; currency: string; checkInTime: string | null; checkOutTime: string | null; minUnits: number; maxUnits: number; businessName: string; others: ServiceSummary[] }`
  - `servicePriceLine(s: { price: string | number; currency: string; duration: number; bookingMode: BookingMode }): string`
  - `serviceTerms(s): { label: string; value: string }[]`
  - `BOOK_ACTION: Record<BookingMode, string>`, `SERVICE_PICK: Record<BookingMode, string>`
  - `serviceMetadata(page: ServicePage | null, path: string): Metadata`
- Produces (`src/server/service-page.ts`, re-exported by `@/server`): `getServicePage(slug: string): Promise<ServicePage | null>`.
- Produces (`src/utils/format.ts`): `shortDay(iso: string): string` ("Fri 2 Oct"), `dayMonth(iso: string): string` ("2 Oct").

- [ ] **Step 1: Export the day formatters**

In `src/utils/format.ts`, change `function shortDay(iso: string) {` to `export function shortDay(iso: string) {` and `function dayMonth(iso: string) {` to `export function dayMonth(iso: string) {`. No other change.

- [ ] **Step 2: Write the failing pure-module test**

Create `src/utils/service-page.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.sara.ng" } }));

import {
  serviceMetadata,
  servicePriceLine,
  serviceTerms,
  type ServicePage,
} from "./service-page";

const BRAIDS: ServicePage = {
  slug: "acme-knotless-braids",
  name: "Knotless braids",
  image: null,
  price: "25000",
  duration: 240,
  bookingMode: "SLOT",
  description: null,
  currency: "NGN",
  checkInTime: null,
  checkOutTime: null,
  minUnits: 1,
  maxUnits: 30,
  businessName: "Acme Salon",
  others: [],
};

const STAY: ServicePage = {
  ...BRAIDS,
  slug: "lekki-4b",
  name: "Lekki 2-bed 4B",
  price: "85000",
  duration: 1440,
  bookingMode: "NIGHTLY",
  checkInTime: "14:00",
  checkOutTime: "11:00",
  minUnits: 2,
  maxUnits: 14,
  businessName: "Lekki Stays",
};

describe("servicePriceLine", () => {
  it("prices a slot with its length and a stay or rental per unit", () => {
    expect(servicePriceLine(BRAIDS)).toBe("NGN 25,000 · 4 hr");
    expect(servicePriceLine(STAY)).toBe("NGN 85,000 per night");
    expect(servicePriceLine({ ...STAY, bookingMode: "DAILY", price: "70000" })).toBe(
      "NGN 70,000 per day",
    );
  });
});

describe("serviceTerms", () => {
  it("gives a slot its length", () => {
    expect(serviceTerms(BRAIDS)).toEqual([{ label: "Length", value: "4 hr" }]);
  });

  it("gives a stay its check-in, check-out and length range", () => {
    expect(serviceTerms(STAY)).toEqual([
      { label: "Check-in", value: "From 14:00" },
      { label: "Check-out", value: "By 11:00" },
      { label: "Stays", value: "2 to 14 nights" },
    ]);
  });

  it("never says '3 to 3' when there is no choice", () => {
    expect(serviceTerms({ ...STAY, minUnits: 3, maxUnits: 3 }).at(-1)).toEqual({
      label: "Stays",
      value: "3 nights",
    });
    expect(
      serviceTerms({ ...STAY, bookingMode: "DAILY", minUnits: 1, maxUnits: 1 }),
    ).toEqual([
      { label: "Days", value: "24 hours from pickup" },
      { label: "Rentals", value: "1 day" },
    ]);
  });

  it("gives a rental its day rule and range", () => {
    expect(serviceTerms({ ...STAY, bookingMode: "DAILY", minUnits: 1, maxUnits: 7 })).toEqual([
      { label: "Days", value: "24 hours from pickup" },
      { label: "Rentals", value: "1 to 7 days" },
    ]);
  });
});

describe("serviceMetadata", () => {
  it("says what it costs, from whom, and what happens next", () => {
    const metadata = serviceMetadata(BRAIDS, "/services/acme-knotless-braids");
    expect(metadata.title).toBe("Knotless braids · Acme Salon");
    expect(metadata.description).toBe(
      "NGN 25,000 for 4 hr with Acme Salon. Pick a time and pay with Paystack.",
    );
    expect(metadata.alternates?.canonical).toBe(
      "https://app.sara.ng/services/acme-knotless-braids",
    );
    expect(metadata.robots).toBeUndefined();
    expect(serviceMetadata(STAY, "/services/lekki-4b").description).toBe(
      "NGN 85,000 a night with Lekki Stays. Pick your dates and pay with Paystack.",
    );
  });

  it("previews an unknown or paused service as a dead link, unindexed", () => {
    const metadata = serviceMetadata(null, "/services/nope");
    expect(metadata.title).toBe("Link not found · Sara");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `yarn test src/utils/service-page.test.ts`
Expected: FAIL — `Failed to resolve import "./service-page"`.

- [ ] **Step 4: Write the pure module**

Create `src/utils/service-page.ts`:

```ts
import type { BookingMode } from "@prisma/client";
import type { Metadata } from "next";

import { formatDuration, formatMoney, unitCount, unitNoun } from "@/utils/format";
import { linkNotFoundMetadata, pageMetadata } from "@/utils/metadata";

/*
 * A service as its public page (/services/<slug>) shows it. Pure, so the
 * page, its link preview and its share card agree on every line.
 */

export type ServiceSummary = {
  slug: string;
  name: string;
  image: string | null;
  price: string;
  duration: number;
  bookingMode: BookingMode;
};

export type ServicePage = ServiceSummary & {
  description: string | null;
  currency: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  minUnits: number;
  maxUnits: number;
  businessName: string;
  /** Up to six other live services from the same business, newest first. */
  others: ServiceSummary[];
};

type Priced = {
  price: string | number;
  currency: string;
  duration: number;
  bookingMode: BookingMode;
};

/** "NGN 25,000 · 4 hr", "NGN 85,000 per night". */
export function servicePriceLine(s: Priced) {
  const price = formatMoney(s.price, s.currency);
  return s.bookingMode === "SLOT"
    ? `${price} · ${formatDuration(s.duration)}`
    : `${price} per ${unitNoun(s.bookingMode, 1)}`;
}

/** The page's one action, in the booking page's own words. */
export const BOOK_ACTION: Record<BookingMode, string> = {
  SLOT: "Book a time",
  NIGHTLY: "Book your stay",
  DAILY: "Book your rental",
};

/** What the booking page asks for next: the preview's last sentence and the card's pill. */
export const SERVICE_PICK: Record<BookingMode, string> = {
  SLOT: "Pick a time",
  NIGHTLY: "Pick your dates",
  DAILY: "Pick your days",
};

/** "2 to 14 nights", or "3 nights" when there is no choice. */
function unitRange(mode: BookingMode, min: number, max: number) {
  return min === max ? unitCount(mode, min) : `${min} to ${unitCount(mode, max)}`;
}

/** The terms a customer needs before booking, one row each. */
export function serviceTerms(
  s: Pick<
    ServicePage,
    "bookingMode" | "duration" | "checkInTime" | "checkOutTime" | "minUnits" | "maxUnits"
  >,
): { label: string; value: string }[] {
  if (s.bookingMode === "SLOT") {
    return [{ label: "Length", value: formatDuration(s.duration) }];
  }
  const range = unitRange(s.bookingMode, s.minUnits, s.maxUnits);
  if (s.bookingMode === "NIGHTLY") {
    return [
      ...(s.checkInTime ? [{ label: "Check-in", value: `From ${s.checkInTime}` }] : []),
      ...(s.checkOutTime ? [{ label: "Check-out", value: `By ${s.checkOutTime}` }] : []),
      { label: "Stays", value: range },
    ];
  }
  return [
    { label: "Days", value: "24 hours from pickup" },
    { label: "Rentals", value: range },
  ];
}

/** The link preview: what it costs, from whom, and what happens next. Indexed. */
export function serviceMetadata(page: ServicePage | null, path: string): Metadata {
  if (!page) return linkNotFoundMetadata(path);
  const price = formatMoney(page.price, page.currency);
  const cost =
    page.bookingMode === "SLOT"
      ? `${price} for ${formatDuration(page.duration)}`
      : `${price} a ${unitNoun(page.bookingMode, 1)}`;
  return pageMetadata({
    title: `${page.name} · ${page.businessName}`,
    description: `${cost} with ${page.businessName}. ${SERVICE_PICK[page.bookingMode]} and pay with Paystack.`,
    path,
  });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `yarn test src/utils/service-page.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing loader test**

Create `src/server/service-page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: { service: { findFirst: vi.fn(), findMany: vi.fn() } },
}));

import { db } from "@/server/db";

import { getServicePage } from "./service-page";

const mockedDb = db as any;

const ROW = {
  id: "svc_1",
  businessId: "biz_1",
  slug: "acme-knotless-braids",
  name: "Knotless braids",
  description: "Waist length, any colour.",
  image: "https://res.cloudinary.com/demo/braids.jpg",
  price: 25000,
  duration: 240,
  bookingMode: "SLOT",
  checkInTime: null,
  checkOutTime: null,
  minUnits: 1,
  maxUnits: 30,
  business: { name: "Acme Salon", currency: "NGN" },
};

beforeEach(() => vi.clearAllMocks());

describe("getServicePage", () => {
  it("reads a live service and up to six of the business's other live services", async () => {
    mockedDb.service.findFirst.mockResolvedValue(ROW);
    mockedDb.service.findMany.mockResolvedValue([
      { slug: "acme-cornrows", name: "Cornrows", image: null, price: 12000, duration: 120, bookingMode: "SLOT" },
    ]);

    const page = await getServicePage("acme-knotless-braids");

    expect(mockedDb.service.findFirst.mock.calls[0][0].where).toEqual({
      slug: "acme-knotless-braids",
      isActive: true,
    });
    expect(mockedDb.service.findMany.mock.calls[0][0]).toMatchObject({
      where: { businessId: "biz_1", isActive: true, id: { not: "svc_1" } },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
    expect(page).toEqual({
      slug: "acme-knotless-braids",
      name: "Knotless braids",
      image: "https://res.cloudinary.com/demo/braids.jpg",
      price: "25000",
      duration: 240,
      bookingMode: "SLOT",
      description: "Waist length, any colour.",
      currency: "NGN",
      checkInTime: null,
      checkOutTime: null,
      minUnits: 1,
      maxUnits: 30,
      businessName: "Acme Salon",
      others: [
        { slug: "acme-cornrows", name: "Cornrows", image: null, price: "12000", duration: 120, bookingMode: "SLOT" },
      ],
    });
  });

  it("returns null for an unknown or paused service without reading others", async () => {
    mockedDb.service.findFirst.mockResolvedValue(null);
    expect(await getServicePage("nope")).toBeNull();
    expect(mockedDb.service.findMany).not.toHaveBeenCalled();
  });

  it("reads only the business's name and currency", async () => {
    mockedDb.service.findFirst.mockResolvedValue(null);
    await getServicePage("x");
    expect(mockedDb.service.findFirst.mock.calls[0][0].select.business).toEqual({
      select: { name: true, currency: true },
    });
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `yarn test src/server/service-page.test.ts`
Expected: FAIL — `Failed to resolve import "./service-page"`.

- [ ] **Step 8: Write the loader**

Create `src/server/service-page.ts`:

```ts
import { cache } from "react";

import { db } from "@/server/db";
import type { ServicePage } from "@/utils/service-page";

const summary = {
  slug: true,
  name: true,
  image: true,
  price: true,
  duration: true,
  bookingMode: true,
} as const;

/**
 * A live service as its public page shows it, with up to six of the
 * business's other live services; null for an unknown slug or a paused
 * service. No availability work: picking a time is /book's job.
 */
export const getServicePage = cache(
  async (slug: string): Promise<ServicePage | null> => {
    const service = await db.service.findFirst({
      where: { slug, isActive: true },
      select: {
        ...summary,
        id: true,
        businessId: true,
        description: true,
        checkInTime: true,
        checkOutTime: true,
        minUnits: true,
        maxUnits: true,
        business: { select: { name: true, currency: true } },
      },
    });
    if (!service) return null;

    const others = await db.service.findMany({
      where: { businessId: service.businessId, isActive: true, id: { not: service.id } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: summary,
    });

    return {
      slug: service.slug,
      name: service.name,
      image: service.image,
      price: service.price.toString(),
      duration: service.duration,
      bookingMode: service.bookingMode,
      description: service.description,
      currency: service.business.currency,
      checkInTime: service.checkInTime,
      checkOutTime: service.checkOutTime,
      minUnits: service.minUnits,
      maxUnits: service.maxUnits,
      businessName: service.business.name,
      others: others.map((other) => ({ ...other, price: other.price.toString() })),
    };
  },
);
```

In `src/server/index.ts`, add after the `./book` export line:

```ts
export { getServicePage } from "./service-page";
```

- [ ] **Step 9: Run to verify it passes**

Run: `yarn test src/server/service-page.test.ts src/utils/service-page.test.ts && npx tsc --noEmit`
Expected: PASS; typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add src/utils/format.ts src/utils/service-page.ts src/utils/service-page.test.ts src/server/service-page.ts src/server/service-page.test.ts src/server/index.ts
git commit -m "feat: service page data and display rules"
```

---

### Task 5: The service page, its card, and the links that lead to it

Before writing UI in this task, load the `impeccable` skill (its `reference/craft-floor.md`) and keep the `design-taste-frontend` pre-flight in mind; Step 8 runs the checks that apply here.

**Files:**
- Modify: `src/server/og.tsx` (add `serviceCard`, moved from `/book`)
- Modify: `src/app/book/[slug]/opengraph-image.tsx`
- Create: `src/components/public/service-profile.tsx`
- Create: `src/app/(public)/services/[slug]/{page,opengraph-image,not-found,loading}.tsx`
- Modify: `src/backend/services/messaging/dispatch/index.ts` (`bookingLinkText`)
- Modify: `src/app/(app)/services/page.tsx`, `src/components/services/services-page-client.tsx`, `src/components/services/service-card.tsx`
- Test: `src/backend/services/messaging/dispatch/index.test.ts`

**Interfaces:**
- Consumes: `getServicePage`, `ServicePage`, `servicePriceLine`, `serviceTerms`, `serviceMetadata`, `BOOK_ACTION`, `SERVICE_PICK` (Task 4); `PublicPage` (Task 3); `servicePath`, `serviceLink` (Task 2).
- Produces:
  - `serviceCard(service: ServiceCardInput): Promise<ImageResponse>` in `src/server/og.tsx`, where `ServiceCardInput = { name: string; businessName: string; price: string | number; currency: string; duration: number; bookingMode: BookingMode; image: string | null }`.
  - `ServiceProfile({ page }: { page: ServicePage })`.
  - `ServiceCard` prop `bookingUrl` renamed to `link`; `ServicesPageClient` prop `bookingBaseUrl` renamed to `publicBaseUrl`.

- [ ] **Step 1: Write the failing chat test**

In `src/backend/services/messaging/dispatch/index.test.ts`, change the `bookingLinkText` assertion to:

```ts
    expect(intentDispatcher.bookingLinkText(options[0]!)).toContain(
      "https://app.sara.ng/services/acme-haircut",
    );
```

Run: `yarn test src/backend/services/messaging/dispatch/index.test.ts`
Expected: FAIL — the text still contains `/book/acme-haircut`.

- [ ] **Step 2: Share the service page from the chat**

In `src/backend/services/messaging/dispatch/index.ts`, change `import { publicLink } from "@/server/share";` to `import { publicLink, serviceLink } from "@/server/share";`, delete `import { publicUrl } from "@/utils/url";`, and in `bookingLinkText` replace `const link = publicUrl("book", option.slug);` with:

```ts
    // The service's page; its "Book a time" opens /book/<slug>.
    const link = serviceLink(option.slug);
```

Run: `yarn test src/backend/services/messaging/dispatch/index.test.ts`
Expected: PASS.

- [ ] **Step 3: Move the service card into og.tsx**

In `src/server/og.tsx`:
- Add imports: `import type { BookingMode } from "@prisma/client";`, `import sharp from "sharp";` and `import { SERVICE_PICK, servicePriceLine } from "@/utils/service-page";`.
- Append:

```tsx
export type ServiceCardInput = {
  name: string;
  businessName: string;
  price: string | number;
  currency: string;
  duration: number;
  bookingMode: BookingMode;
  image: string | null;
};

const PANEL = { width: 420, height: 502 };

/** A photo as a JPEG data URL cropped to the card's right panel, or null. */
async function panelPhoto(url: string | null) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const jpeg = await sharp(Buffer.from(await response.arrayBuffer()))
      .resize(PANEL.width * 2, PANEL.height * 2, { fit: "cover" })
      .jpeg({ quality: 82 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

/*
 * A service's card, for its booking link (/book) and its page (/services)
 * alike. Owners drop these links in Instagram bios and DMs, so the card is
 * the service's own: the business, the service, its price, a pill saying
 * what comes next, and the service photo (the mark on leaf grey when there
 * is none). Sara signs it quietly at the foot, single ink.
 */
export async function serviceCard(service: ServiceCardInput) {
  const image = await panelPhoto(service.image);
  const titleSize = service.name.length > 28 ? 60 : 76;

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: OG.canvas,
        padding: 64,
        gap: 56,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flex: 1,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontFamily: "Hanken", fontWeight: 600, fontSize: 28, color: OG.muted }}>
            {clip(service.businessName, 36)}
          </div>
          <div
            style={{
              fontFamily: "Bricolage",
              fontSize: titleSize,
              lineHeight: 1.04,
              letterSpacing: -0.035 * titleSize,
              color: OG.ink,
            }}
          >
            {service.name}
          </div>
          <div style={{ fontFamily: "Hanken", fontSize: 30, color: OG.ink, marginTop: 6 }}>
            {servicePriceLine(service)}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              height: 68,
              padding: "0 34px",
              borderRadius: 999,
              background: OG.accent,
              color: OG.onAccent,
              fontFamily: "Hanken",
              fontWeight: 600,
              fontSize: 28,
            }}
          >
            {SERVICE_PICK[service.bookingMode]}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontFamily: "Hanken",
              fontSize: 22,
              color: OG.faint,
            }}
          >
            Bookings by
            <OgLockup size={30} color={OG.faint} accent={OG.faint} />
          </div>
        </div>
      </div>

      {image ? (
        <img src={image} alt="" {...PANEL} style={{ borderRadius: 32, objectFit: "cover" }} />
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...PANEL,
            borderRadius: 32,
            background: OG.surface,
          }}
        >
          <OgMark size={200} />
        </div>
      )}
    </div>,
    { ...OG_SIZE, fonts: await ogFonts() },
  );
}
```

(`clip`, `OG`, `OgLockup`, `OgMark`, `ogFonts`, `OG_SIZE` already exist in the file; `clip` is declared above `documentCard`, so place this code after it.)

Replace the whole of `src/app/book/[slug]/opengraph-image.tsx` with:

```tsx
import { getServicePage } from "@/server";
import { pageCard, serviceCard } from "@/server/og";
import { OG_SIZE } from "@/utils/metadata";

/*
 * A booking link's share card: the service's own (server/og.tsx), the same
 * card its /services page wears. An unknown or paused link gets the site
 * card. Reads the service without availability: a card needs no slots.
 */

export const alt = "Book a time";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ slug: string }> };

export default async function BookingOpenGraphImage({ params }: Params) {
  const { slug } = await params;
  const service = await getServicePage(slug).catch(() => null);
  return service ? serviceCard(service) : pageCard("site");
}
```

- [ ] **Step 4: Build the page component**

Create `src/components/public/service-profile.tsx`:

```tsx
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";

import { PublicPage } from "@/components/public/public-page";
import { Button } from "@/primitives";
import { cn } from "@/utils/cn";
import { servicePath } from "@/utils/public-links";
import {
  BOOK_ACTION,
  servicePriceLine,
  serviceTerms,
  type ServicePage,
} from "@/utils/service-page";

/**
 * A service's public page: the photo, what it is and costs, its terms, and
 * one action into /book, where the customer picks a time and pays. Below,
 * the business's other live services. Phone first: the action rides a
 * bottom bar on phones and sits under the price from `lg`.
 */
export function ServiceProfile({ page }: { page: ServicePage }) {
  const action = BOOK_ACTION[page.bookingMode];
  const book = `/book/${encodeURIComponent(page.slug)}`;

  return (
    <PublicPage
      businessName={page.businessName}
      credit="Bookings"
      width="wide"
      className="pb-32 lg:pb-16"
    >
      <div
        className={cn(
          "grid gap-8 pt-4 lg:items-start lg:gap-16 lg:pt-12",
          page.image && "lg:grid-cols-[1fr_460px]",
        )}
      >
        {page.image ? (
          <div className="rounded-shot bg-surface outline-ink/5 animate-rise relative aspect-[16/10] overflow-hidden outline outline-1 -outline-offset-1 lg:sticky lg:top-8 lg:order-2 lg:aspect-[4/5]">
            <Image
              src={page.image}
              alt={page.name}
              fill
              sizes="(min-width: 1024px) 460px, 100vw"
              className="object-cover"
              priority
            />
          </div>
        ) : null}

        <section aria-labelledby="service-h" className="animate-rise-1 lg:order-1">
          <h1
            id="service-h"
            className="font-display max-w-[18ch] text-[clamp(2.1rem,1.4rem+3vw,3.4rem)] leading-[1.04] font-[380] tracking-[-0.035em] text-balance"
          >
            {page.name}
          </h1>
          <p className="mt-3 text-[17px] font-semibold">{servicePriceLine(page)}</p>
          <Button asChild size="lg" className="mt-6 hidden lg:inline-flex">
            <Link href={book}>{action}</Link>
          </Button>
          {page.description ? (
            <p className="text-muted mt-6 max-w-[60ch] text-pretty whitespace-pre-line">
              {page.description}
            </p>
          ) : null}
          <dl className="border-line mt-8 grid max-w-[480px] gap-3 border-t pt-6 text-[15px]">
            {serviceTerms(page).map((term) => (
              <div key={term.label} className="flex items-baseline justify-between gap-4">
                <dt className="text-muted">{term.label}</dt>
                <dd className="text-right">{term.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {page.others.length > 0 ? (
        <section aria-labelledby="more-h" className="animate-rise-2 mt-16 lg:mt-24">
          <h2
            id="more-h"
            className="font-display text-[22px] leading-[1.2] font-medium tracking-[-0.02em]"
          >
            More from {page.businessName}
          </h2>
          <ul className="mt-5 grid gap-2.5 min-[700px]:grid-cols-2">
            {page.others.map((other) => (
              <li key={other.slug}>
                <Link
                  href={servicePath(other.slug)}
                  className="rounded-card bg-surface hover:bg-accent-soft focus-visible:outline-accent-ink flex items-center gap-4 px-4 py-3.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-3"
                >
                  {other.image ? (
                    <span className="rounded-chip relative size-14 shrink-0 overflow-hidden">
                      <Image src={other.image} alt="" fill sizes="56px" className="object-cover" />
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{other.name}</span>
                    <span className="text-muted block text-sm">
                      {servicePriceLine({ ...other, currency: page.currency })}
                    </span>
                  </span>
                  <CaretRight weight="bold" className="text-faint size-4 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Phone: the one action, pinned to the bottom edge. */}
      <div className="border-line bg-canvas/92 fixed inset-x-0 bottom-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
        <Button asChild size="lg" className="w-full">
          <Link href={book}>{action}</Link>
        </Button>
      </div>
    </PublicPage>
  );
}
```

- [ ] **Step 5: Create the service routes**

Create `src/app/(public)/services/[slug]/page.tsx`:

```tsx
import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicError } from "@/components/public-error";
import { ServiceProfile } from "@/components/public/service-profile";
import { getServicePage } from "@/server";
import { servicePath } from "@/utils/public-links";
import { serviceMetadata } from "@/utils/service-page";

type Params = { params: Promise<{ slug: string }> };

// A paused service must stop showing at once.
export const dynamic = "force-dynamic";

/** A service's public page; its action hands off to /book/<slug>. Card: ./opengraph-image.tsx. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const page = await getServicePage(slug).catch(() => null);
  return serviceMetadata(page, servicePath(slug));
}

export default async function ServicePublicPage({ params }: Params) {
  const { slug } = await params;

  let page;
  try {
    page = await getServicePage(slug);
  } catch (error) {
    console.error("[services] failed to load service:", error);
    return (
      <PublicError
        title="This service didn't load."
        body="Something went wrong on our side. Refresh the page to try again."
      />
    );
  }

  if (!page) notFound();

  return <ServiceProfile page={page} />;
}
```

Create `src/app/(public)/services/[slug]/opengraph-image.tsx`:

```tsx
import { getServicePage } from "@/server";
import { pageCard, serviceCard } from "@/server/og";
import { OG_SIZE } from "@/utils/metadata";

/* A service page's share card: the same card as its booking link. */

export const alt = "Book a time";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ slug: string }> };

export default async function ServiceOpenGraphImage({ params }: Params) {
  const { slug } = await params;
  const page = await getServicePage(slug).catch(() => null);
  return page ? serviceCard(page) : pageCard("site");
}
```

Create `src/app/(public)/services/[slug]/not-found.tsx`:

```tsx
import { PublicError } from "@/components/public-error";

export default function ServiceNotFound() {
  return (
    <PublicError
      title="This service isn't taking bookings."
      body="It may have been paused or renamed. Ask the business for a fresh link."
    />
  );
}
```

Create `src/app/(public)/services/[slug]/loading.tsx`:

```tsx
import { Skeleton } from "@/primitives";

/** The service page's shape while it loads. */
export default function ServiceLoading() {
  return (
    <main className="bg-canvas min-h-dvh" aria-busy="true" aria-label="Loading">
      <div className="max-w-page mx-auto px-4 md:px-8">
        <div className="flex h-16 items-center">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid gap-8 pt-4 lg:grid-cols-[1fr_460px] lg:gap-16 lg:pt-12">
          <Skeleton className="rounded-shot aspect-[16/10] lg:order-2 lg:aspect-[4/5]" />
          <div className="lg:order-1">
            <Skeleton className="h-11 w-4/5 max-w-[420px]" />
            <Skeleton className="mt-4 h-5 w-40" />
            <Skeleton className="mt-6 h-4 w-full max-w-[460px]" />
            <Skeleton className="mt-2 h-4 w-2/3 max-w-[320px]" />
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Point the owner's service card at the service page**

`src/app/(app)/services/page.tsx`: replace `import { publicUrl } from "@/utils/url";` with `import { appBaseUrl } from "@/utils/url";` and the prop `bookingBaseUrl={publicUrl("book", "").replace(/\/$/, "")}` with `publicBaseUrl={appBaseUrl()}`.

`src/components/services/services-page-client.tsx`: rename the prop `bookingBaseUrl: string;` to `publicBaseUrl: string;` (interface and destructuring), add `import { servicePath } from "@/utils/public-links";`, change the `ServiceCard` prop to `link={`${publicBaseUrl}${servicePath(service.slug)}`}`, and in the empty-state bubble change `app.sara.ng/book/knotless-braids` to `app.sara.ng/services/knotless-braids`.

`src/components/services/service-card.tsx`: rename the prop `bookingUrl` to `link` in the interface, the destructuring and the three uses (`displayUrl`, `title`, `CopyLinkButton url`), and change the doc comment to `/** One service: its label, its public link, and what can be done to it. */`.

- [ ] **Step 7: Typecheck, test, build**

Run: `npx tsc --noEmit && yarn test && npx next build --no-lint`
Expected: all pass; the route table shows `ƒ /services/[slug]` and `ƒ /services/[slug]/opengraph-image` beside `/services`.

Run: `npx eslint src/server/og.tsx "src/app/book/[slug]/opengraph-image.tsx" src/components/public "src/app/(public)/services" src/backend/services/messaging/dispatch src/components/services "src/app/(app)/services/page.tsx"`
Expected: no errors.

- [ ] **Step 8: Design pre-flight (impeccable craft floor + taste v2)**

Run:

```bash
grep -n "—\|–" src/components/public/service-profile.tsx "src/app/(public)/services/[slug]/"*.tsx src/utils/service-page.ts
grep -nE "#[0-9a-fA-F]{3,8}\b" src/components/public/service-profile.tsx
```

Expected: no output from either (no dashes in copy, no hard-coded colours).

Then check by reading `service-profile.tsx` against the craft floor: one primary action per breakpoint (bottom bar below `lg`, inline from `lg`, never both visible); every link and button has a visible focus style (the `Button` primitive and the `focus-visible:` classes on the rows); the no-photo case renders a single column with no empty panel; "More from" is absent when `others` is empty. If a database is reachable, open `/services/<slug>` at 375px and 1280px wide (the `run` skill can drive the browser) for a service with a photo and one without, and fix anything the craft floor flags in one batch.

- [ ] **Step 9: Commit**

```bash
git add src/server/og.tsx "src/app/book/[slug]/opengraph-image.tsx" src/components/public/service-profile.tsx "src/app/(public)/services" src/backend/services/messaging/dispatch src/components/services "src/app/(app)/services/page.tsx"
git commit -m "feat: public service page at /services/<slug> with its share card"
```

---

### Task 6: Booking page data, the calendar file and the receipt link

**Files:**
- Create: `src/utils/booking-view.ts`
- Create: `src/utils/ics.ts`
- Create: `src/server/booking-page.ts`
- Modify: `src/server/index.ts`
- Modify: `src/app/api/webhooks/paystack/route.ts` (`paymentData`)
- Test: `src/utils/booking-view.test.ts`, `src/utils/ics.test.ts`, `src/server/booking-page.test.ts`, `src/app/api/webhooks/paystack/route.test.ts`

**Interfaces:**
- Consumes: `publicPath` (Task 2), `linkNotFoundMetadata` (Task 3), `shortDay`, `formatSlotMoment`, `unitCount` (`src/utils/format.ts`), `wallClockNow` (`src/backend/services/booking/clock.ts`), `Payment.bookingId` (Task 2).
- Produces (`src/utils/booking-view.ts`):
  - `type PublicBooking = { publicId: string; status: BookingStatus; startTime: string; endTime: string; units: number; holdExpiresAt: string | null; amount: number; currency: string; clientName: string; service: { slug: string; name: string; bookingMode: BookingMode }; businessName: string; businessAddress: string | null; receiptPath: string | null }`
  - `type BookingView = "upcoming" | "past" | "done" | "held" | "released" | "cancelled"`
  - `bookingView(b: Pick<PublicBooking, "status" | "startTime" | "holdExpiresAt">, now?: Date): BookingView`
  - `bookingPill(view: BookingView): { label: string; tone: "accent" | "muted" }`
  - `bookingDates(b: Pick<PublicBooking, "startTime" | "endTime" | "units"> & { bookingMode: BookingMode }): string`
  - `bookingMetadata(booking: PublicBooking | null, path: string, now?: Date): Metadata`
- Produces (`src/utils/ics.ts`): `bookingIcs(booking: Pick<PublicBooking, "publicId" | "startTime" | "endTime" | "businessName" | "businessAddress"> & { service: { name: string } }, options: { url: string; now?: Date }): string`
- Produces (`src/server/booking-page.ts`, re-exported by `@/server`): `getPublicBooking(publicId: string): Promise<PublicBooking | null>`.

- [ ] **Step 1: Write the failing booking-view test**

Create `src/utils/booking-view.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.sara.ng" } }));

import {
  bookingDates,
  bookingMetadata,
  bookingPill,
  bookingView,
  type PublicBooking,
} from "./booking-view";

// 14:00 Lagos on Mon 12 Oct, stored as 14:00Z (wall-clock written as UTC).
const BOOKING: PublicBooking = {
  publicId: "Pq8sN1xV0kL3mA6t",
  status: "CONFIRMED",
  startTime: "2026-10-12T14:00:00.000Z",
  endTime: "2026-10-12T18:00:00.000Z",
  units: 1,
  holdExpiresAt: null,
  amount: 25000,
  currency: "NGN",
  clientName: "Ada Okafor",
  service: { slug: "acme-knotless-braids", name: "Knotless braids", bookingMode: "SLOT" },
  businessName: "Acme Salon",
  businessAddress: "12 Admiralty Way, Lekki",
  receiptPath: null,
};

describe("bookingView", () => {
  it("compares the start with Lagos wall-clock time, not UTC", () => {
    // 12:30Z is 13:30 in Lagos: still to come.
    expect(bookingView(BOOKING, new Date("2026-10-12T12:30:00.000Z"))).toBe("upcoming");
    // 13:30Z is 14:30 in Lagos: it has started.
    expect(bookingView(BOOKING, new Date("2026-10-12T13:30:00.000Z"))).toBe("past");
  });

  it("reads done and cancelled from the status", () => {
    expect(bookingView({ ...BOOKING, status: "COMPLETED" })).toBe("done");
    expect(bookingView({ ...BOOKING, status: "CANCELLED" })).toBe("cancelled");
  });

  it("holds an unpaid booking until its hold expires, then releases it", () => {
    const held = { ...BOOKING, status: "PENDING" as const, holdExpiresAt: "2026-10-06T10:30:00.000Z" };
    expect(bookingView(held, new Date("2026-10-06T10:29:59.000Z"))).toBe("held");
    expect(bookingView(held, new Date("2026-10-06T10:30:00.000Z"))).toBe("released");
  });

  it("releases an unpaid booking from before holds existed", () => {
    expect(bookingView({ ...BOOKING, status: "PENDING", holdExpiresAt: null })).toBe("released");
  });
});

describe("bookingPill", () => {
  it("says Expired, not Awaiting payment, once the hold has gone", () => {
    expect(bookingPill("released")).toEqual({ label: "Expired", tone: "muted" });
    expect(bookingPill("held")).toEqual({ label: "Awaiting payment", tone: "muted" });
    expect(bookingPill("upcoming")).toEqual({ label: "Confirmed", tone: "accent" });
  });
});

describe("bookingDates", () => {
  it("names a slot's day and time, and a stay's two days and length", () => {
    expect(bookingDates({ ...BOOKING, bookingMode: "SLOT" })).toBe("Mon 12 Oct at 14:00");
    expect(
      bookingDates({
        startTime: "2026-10-02T14:00:00.000Z",
        endTime: "2026-10-05T12:00:00.000Z",
        units: 3,
        bookingMode: "NIGHTLY",
      }),
    ).toBe("Fri 2 Oct to Mon 5 Oct, 3 nights");
  });
});

describe("bookingMetadata", () => {
  const path = "/bookings/Pq8sN1xV0kL3mA6t";

  it("previews a confirmed booking by its time, unindexed", () => {
    const metadata = bookingMetadata(BOOKING, path, new Date("2026-10-06T10:00:00.000Z"));
    expect(metadata.title).toBe("Knotless braids with Acme Salon");
    expect(metadata.description).toBe("Confirmed for Mon 12 Oct at 14:00.");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("never previews a dead booking as active", () => {
    expect(bookingMetadata({ ...BOOKING, status: "CANCELLED" }, path).description).toBe(
      "This booking is no longer active.",
    );
    expect(bookingMetadata(null, path).title).toBe("Link not found · Sara");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test src/utils/booking-view.test.ts`
Expected: FAIL — `Failed to resolve import "./booking-view"`.

- [ ] **Step 3: Write the booking-view module**

Create `src/utils/booking-view.ts`:

```ts
import type { BookingMode, BookingStatus } from "@prisma/client";
import type { Metadata } from "next";

import { wallClockNow } from "@/backend/services/booking/clock";
import { formatSlotMoment, shortDay, unitCount } from "@/utils/format";
import { linkNotFoundMetadata, pageMetadata } from "@/utils/metadata";

/*
 * A customer's booking as its link (/bookings/<publicId>) shows it. Pure, so
 * the page, its link preview, its card and its calendar file agree.
 */

/** What a booking's public page may show: never a phone number or an email. */
export type PublicBooking = {
  publicId: string;
  status: BookingStatus;
  /** Lagos wall-clock written as UTC (utils/format.ts). */
  startTime: string;
  endTime: string;
  units: number;
  /** A real instant: when an unpaid booking stops holding its time. */
  holdExpiresAt: string | null;
  amount: number;
  currency: string;
  clientName: string;
  service: { slug: string; name: string; bookingMode: BookingMode };
  businessName: string;
  /** "12 Admiralty Way, Lekki, Lagos", or null when the business has none. */
  businessAddress: string | null;
  /** "/receipts/<publicId>" of the booking's newest receipt, or null. */
  receiptPath: string | null;
};

export type BookingView =
  | "upcoming" // confirmed, still to come
  | "past" // confirmed, started
  | "done" // marked done by the owner
  | "held" // unpaid, time held
  | "released" // unpaid, hold ran out (or booked before holds existed)
  | "cancelled";

/**
 * Where the booking stands for its customer. Two clocks: startTime is Lagos
 * wall-clock written as UTC, so it is compared with wallClockNow(); the hold
 * is a real instant, compared with `now` itself.
 */
export function bookingView(
  b: Pick<PublicBooking, "status" | "startTime" | "holdExpiresAt">,
  now: Date = new Date(),
): BookingView {
  switch (b.status) {
    case "CANCELLED":
      return "cancelled";
    case "COMPLETED":
      return "done";
    case "PENDING":
      return b.holdExpiresAt && new Date(b.holdExpiresAt) > now ? "held" : "released";
    case "CONFIRMED":
      return new Date(b.startTime) > wallClockNow(now) ? "upcoming" : "past";
  }
}

const PILL: Record<BookingView, { label: string; tone: "accent" | "muted" }> = {
  upcoming: { label: "Confirmed", tone: "accent" },
  past: { label: "Confirmed", tone: "accent" },
  done: { label: "Done", tone: "muted" },
  held: { label: "Awaiting payment", tone: "muted" },
  released: { label: "Expired", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

/** The status pill. An unpaid booking whose hold ran out reads "Expired". */
export function bookingPill(view: BookingView) {
  return PILL[view];
}

/** "Mon 12 Oct at 14:00", "Fri 2 Oct to Mon 5 Oct, 3 nights". */
export function bookingDates(
  b: Pick<PublicBooking, "startTime" | "endTime" | "units"> & { bookingMode: BookingMode },
) {
  if (b.bookingMode === "SLOT") return formatSlotMoment(b.startTime);
  return `${shortDay(b.startTime)} to ${shortDay(b.endTime)}, ${unitCount(b.bookingMode, b.units)}`;
}

/** The link preview: the booking's time and state. Never indexed. */
export function bookingMetadata(
  booking: PublicBooking | null,
  path: string,
  now: Date = new Date(),
): Metadata {
  if (!booking) return linkNotFoundMetadata(path);
  const dates = bookingDates({ ...booking, bookingMode: booking.service.bookingMode });
  const description: Record<BookingView, string> = {
    upcoming: `Confirmed for ${dates}.`,
    past: `Confirmed for ${dates}.`,
    done: `Done on ${shortDay(booking.startTime)}.`,
    held: `Confirming payment for ${dates}.`,
    released: "This booking is no longer active.",
    cancelled: "This booking is no longer active.",
  };
  return pageMetadata({
    title: `${booking.service.name} with ${booking.businessName}`,
    description: description[bookingView(booking, now)],
    path,
    index: false,
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test src/utils/booking-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing calendar-file test**

Create `src/utils/ics.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { bookingIcs } from "./ics";

const SLOT = {
  publicId: "Pq8sN1xV0kL3mA6t",
  startTime: "2026-10-12T14:00:00.000Z",
  endTime: "2026-10-12T18:00:00.000Z",
  businessName: "Acme Salon",
  businessAddress: "12 Admiralty Way, Lekki",
  service: { name: "Knotless braids" },
};
const options = {
  url: "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",
  now: new Date("2026-10-06T10:15:00.000Z"),
};
const encoder = new TextEncoder();
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("bookingIcs", () => {
  it("writes one event with floating local times", () => {
    const ics = bookingIcs(SLOT, options);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("\r\nUID:Pq8sN1xV0kL3mA6t@sara\r\n");
    expect(ics).toContain("\r\nDTSTAMP:20261006T101500Z\r\n");
    // No Z: the stored digits are the Lagos time the customer was shown.
    expect(ics).toContain("\r\nDTSTART:20261012T140000\r\n");
    expect(ics).toContain("\r\nDTEND:20261012T180000\r\n");
    expect(ics).toContain("\r\nSUMMARY:Knotless braids with Acme Salon\r\n");
    expect(ics).toContain("\r\nLOCATION:12 Admiralty Way\\, Lekki\r\n");
    expect(ics).toContain("\r\nURL:https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t\r\n");
  });

  it("spans a stay from check-in to check-out", () => {
    const ics = bookingIcs(
      { ...SLOT, startTime: "2026-10-02T14:00:00.000Z", endTime: "2026-10-05T12:00:00.000Z" },
      options,
    );
    expect(ics).toContain("\r\nDTSTART:20261002T140000\r\n");
    expect(ics).toContain("\r\nDTEND:20261005T120000\r\n");
  });

  it("leaves LOCATION out when the business has no address", () => {
    expect(bookingIcs({ ...SLOT, businessAddress: null }, options)).not.toContain("LOCATION");
  });

  it("escapes commas, semicolons and backslashes in text", () => {
    const ics = bookingIcs({ ...SLOT, businessName: "Tolú's Hair, Lekki; VI \\ 2" }, options);
    expect(unfold(ics)).toContain("SUMMARY:Knotless braids with Tolú's Hair\\, Lekki\\; VI \\\\ 2\r\n");
  });

  it("folds long lines at 75 octets, counting multi-byte characters", () => {
    const name = "Tolú's Hair Studio ".repeat(8).trim();
    const ics = bookingIcs({ ...SLOT, businessName: name }, options);
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(unfold(ics)).toContain(`SUMMARY:Knotless braids with ${name}\r\n`);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `yarn test src/utils/ics.test.ts`
Expected: FAIL — `Failed to resolve import "./ics"`.

- [ ] **Step 7: Write the calendar-file module**

Create `src/utils/ics.ts`:

```ts
import type { PublicBooking } from "@/utils/booking-view";

/*
 * A one-event calendar file (RFC 5545) for a confirmed booking, behind "Add
 * to calendar". Times are floating (no Z, no TZID): booking times are Lagos
 * wall-clock written as UTC, so the stored digits are the time the customer
 * was shown, and a floating time shows them as they are.
 */

const encoder = new TextEncoder();

/** 2026-10-12T14:00:00.000Z → 20261012T140000. */
const floating = (iso: string) => iso.replace(/[-:]/g, "").slice(0, 15);

/** A real instant, in UTC: 20261006T101500Z. */
const utc = (date: Date) => `${floating(date.toISOString())}Z`;

/** RFC 5545 TEXT: backslash, semicolon and comma escaped; newlines as \n. */
function text(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets; each continuation starts with a space. */
function fold(line: string) {
  const parts: string[] = [];
  let part = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      parts.push(part);
      part = "";
      octets = 0;
    }
    part += char;
    octets += size;
  }
  parts.push(part);
  return parts.join("\r\n ");
}

export function bookingIcs(
  booking: Pick<
    PublicBooking,
    "publicId" | "startTime" | "endTime" | "businessName" | "businessAddress"
  > & { service: { name: string } },
  { url, now = new Date() }: { url: string; now?: Date },
) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sara//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${booking.publicId}@sara`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${floating(booking.startTime)}`,
    `DTEND:${floating(booking.endTime)}`,
    `SUMMARY:${text(`${booking.service.name} with ${booking.businessName}`)}`,
    ...(booking.businessAddress ? [`LOCATION:${text(booking.businessAddress)}`] : []),
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `yarn test src/utils/ics.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing loader test**

Create `src/server/booking-page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: { booking: { findUnique: vi.fn() } } }));

import { db } from "@/server/db";

import { getPublicBooking } from "./booking-page";

const mockedDb = db as any;

const ROW = {
  publicId: "Pq8sN1xV0kL3mA6t",
  status: "CONFIRMED",
  startTime: new Date("2026-10-12T14:00:00.000Z"),
  endTime: new Date("2026-10-12T18:00:00.000Z"),
  units: 1,
  holdExpiresAt: null,
  amount: 25000,
  clientName: "Ada Okafor",
  service: { slug: "acme-knotless-braids", name: "Knotless braids", bookingMode: "SLOT" },
  business: {
    name: "Acme Salon",
    currency: "NGN",
    address: "12 Admiralty Way",
    city: "Lekki",
    state: " ",
  },
  payments: [{ receipt: { publicId: "b7T0qLm2Vn9cZ4wE" } }],
};

beforeEach(() => vi.clearAllMocks());

describe("getPublicBooking", () => {
  it("maps the booking for its page", async () => {
    mockedDb.booking.findUnique.mockResolvedValue(ROW);
    expect(await getPublicBooking("Pq8sN1xV0kL3mA6t")).toEqual({
      publicId: "Pq8sN1xV0kL3mA6t",
      status: "CONFIRMED",
      startTime: "2026-10-12T14:00:00.000Z",
      endTime: "2026-10-12T18:00:00.000Z",
      units: 1,
      holdExpiresAt: null,
      amount: 25000,
      currency: "NGN",
      clientName: "Ada Okafor",
      service: { slug: "acme-knotless-braids", name: "Knotless braids", bookingMode: "SLOT" },
      businessName: "Acme Salon",
      businessAddress: "12 Admiralty Way, Lekki",
      receiptPath: "/receipts/b7T0qLm2Vn9cZ4wE",
    });
  });

  it("finds the booking by public id alone, whatever its service's state", async () => {
    mockedDb.booking.findUnique.mockResolvedValue(null);
    await getPublicBooking("Pq8sN1xV0kL3mA6t");
    expect(mockedDb.booking.findUnique.mock.calls[0][0].where).toEqual({
      publicId: "Pq8sN1xV0kL3mA6t",
    });
  });

  it("has no address and no receipt when there are none", async () => {
    mockedDb.booking.findUnique.mockResolvedValue({
      ...ROW,
      business: { ...ROW.business, address: null, city: null, state: null },
      payments: [],
    });
    expect(await getPublicBooking("Pq8sN1xV0kL3mA6t")).toMatchObject({
      businessAddress: null,
      receiptPath: null,
    });
  });

  it("returns null for an unknown id", async () => {
    mockedDb.booking.findUnique.mockResolvedValue(null);
    expect(await getPublicBooking("nope")).toBeNull();
  });

  it("never reads the customer's or the business's contact details", async () => {
    mockedDb.booking.findUnique.mockResolvedValue(null);
    await getPublicBooking("x");
    const { select } = mockedDb.booking.findUnique.mock.calls[0][0];
    expect(select).not.toHaveProperty("clientEmail");
    expect(select).not.toHaveProperty("clientPhone");
    expect(select.business.select).not.toHaveProperty("email");
    expect(select.business.select).not.toHaveProperty("phone");
  });
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `yarn test src/server/booking-page.test.ts`
Expected: FAIL — `Failed to resolve import "./booking-page"`.

- [ ] **Step 11: Write the loader**

Create `src/server/booking-page.ts`:

```ts
import { cache } from "react";

import { db } from "@/server/db";
import type { PublicBooking } from "@/utils/booking-view";
import { publicPath } from "@/utils/public-links";

/**
 * The booking behind a customer's link, or null for an unknown id. A paused
 * or renamed service still shows: the booking is the customer's either way.
 * Never reads a phone number or an email address.
 */
export const getPublicBooking = cache(
  async (publicId: string): Promise<PublicBooking | null> => {
    const booking = await db.booking.findUnique({
      where: { publicId },
      select: {
        publicId: true,
        status: true,
        startTime: true,
        endTime: true,
        units: true,
        holdExpiresAt: true,
        amount: true,
        clientName: true,
        service: { select: { slug: true, name: true, bookingMode: true } },
        business: {
          select: { name: true, currency: true, address: true, city: true, state: true },
        },
        payments: {
          where: { receipt: { isNot: null } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { receipt: { select: { publicId: true } } },
        },
      },
    });
    if (!booking) return null;

    const receipt = booking.payments[0]?.receipt;
    // Blank parts (" ") are dropped, as the reminder email does.
    const address = [booking.business.address, booking.business.city, booking.business.state]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(", ");

    return {
      publicId: booking.publicId,
      status: booking.status,
      startTime: booking.startTime.toISOString(),
      endTime: booking.endTime.toISOString(),
      units: booking.units,
      holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
      amount: Number(booking.amount),
      currency: booking.business.currency,
      clientName: booking.clientName,
      service: booking.service,
      businessName: booking.business.name,
      businessAddress: address || null,
      receiptPath: receipt ? publicPath("receipt", receipt.publicId) : null,
    };
  },
);
```

In `src/server/index.ts`, add:

```ts
export { getPublicBooking } from "./booking-page";
```

- [ ] **Step 12: Run to verify it passes**

Run: `yarn test src/server/booking-page.test.ts`
Expected: PASS.

- [ ] **Step 13: Write the failing webhook test**

Add to the `describe` in `src/app/api/webhooks/paystack/route.test.ts`:

```ts
  it("records which booking the payment was for, so the booking finds its receipt", async () => {
    await POST(buildRequest(buildEvent()));
    expect(mockedDb.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ bookingId: BOOKING.id, reference: "ref_123" }),
    });
  });
```

Run: `yarn test src/app/api/webhooks/paystack/route.test.ts`
Expected: FAIL — `bookingId` is missing from the created payment.

- [ ] **Step 14: Link the payment to its booking**

In `src/app/api/webhooks/paystack/route.ts`, in the `paymentData` object, after `businessId,` add:

```ts
    bookingId: booking.id,
```

Run: `yarn test src/app/api/webhooks/paystack/route.test.ts && npx tsc --noEmit`
Expected: PASS; typecheck clean.

- [ ] **Step 15: Commit**

```bash
git add src/utils/booking-view.ts src/utils/booking-view.test.ts src/utils/ics.ts src/utils/ics.test.ts src/server/booking-page.ts src/server/booking-page.test.ts src/server/index.ts src/app/api/webhooks/paystack
git commit -m "feat: booking page data, calendar file builder, and payments linked to bookings"
```

---

### Task 7: The booking page, its card and `calendar.ics`

Before writing UI in this task, load the `impeccable` skill (its `reference/craft-floor.md`); Step 7 runs the checks that apply here.

**Files:**
- Modify: `src/server/og.tsx` (add `bookingCard`)
- Create: `src/components/public/booking-page.tsx`
- Create: `src/app/(public)/bookings/[publicId]/{page,opengraph-image,not-found,loading}.tsx`
- Create: `src/app/(public)/bookings/[publicId]/calendar.ics/route.ts`
- Test: `src/app/(public)/bookings/[publicId]/calendar.ics/route.test.ts`

**Interfaces:**
- Consumes: `getPublicBooking`, `PublicBooking`, `BookingView`, `bookingView`, `bookingPill`, `bookingMetadata`, `bookingIcs` (Task 6); `PublicPage`, `PublicDetailSkeleton` (Task 3); `publicPath`, `publicLink` (Task 2); `AwaitConfirmation` (`src/components/book/await-confirmation.tsx`); `shortDay`, `dayMonth` (Task 4).
- Produces: `bookingCard(booking: PublicBooking, view: BookingView): Promise<ImageResponse>`; `PublicBookingPage({ booking, view })`; `GET /bookings/<publicId>/calendar.ics`.

- [ ] **Step 1: Write the failing calendar route test**

Create `src/app/(public)/bookings/[publicId]/calendar.ics/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.sara.ng" } }));
vi.mock("@/server", () => ({ getPublicBooking: vi.fn() }));

import { getPublicBooking } from "@/server";

import { GET } from "./route";

const mockedGet = getPublicBooking as any;

const UPCOMING = {
  publicId: "Pq8sN1xV0kL3mA6t",
  status: "CONFIRMED",
  startTime: "2099-10-12T14:00:00.000Z",
  endTime: "2099-10-12T18:00:00.000Z",
  units: 1,
  holdExpiresAt: null,
  amount: 25000,
  currency: "NGN",
  clientName: "Ada Okafor",
  service: { slug: "acme-knotless-braids", name: "Knotless braids", bookingMode: "SLOT" },
  businessName: "Acme Salon",
  businessAddress: null,
  receiptPath: null,
};

const call = (publicId = "Pq8sN1xV0kL3mA6t") =>
  GET(new Request(`https://app.sara.ng/bookings/${publicId}/calendar.ics`), {
    params: Promise.resolve({ publicId }),
  });

beforeEach(() => vi.clearAllMocks());

describe("GET /bookings/[publicId]/calendar.ics", () => {
  it("downloads the event for a booking still to come", async () => {
    mockedGet.mockResolvedValue(UPCOMING);
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="booking.ics"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain("DTSTART:20991012T140000");
    expect(body).toContain("URL:https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t");
  });

  it("answers 404 for an unknown, cancelled or past booking", async () => {
    mockedGet.mockResolvedValue(null);
    expect((await call("nope")).status).toBe(404);
    mockedGet.mockResolvedValue({ ...UPCOMING, status: "CANCELLED" });
    expect((await call()).status).toBe(404);
    mockedGet.mockResolvedValue({ ...UPCOMING, startTime: "2020-01-01T10:00:00.000Z" });
    expect((await call()).status).toBe(404);
  });
});
```

Run: `yarn test "src/app/(public)/bookings"`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 2: Write the calendar route**

Create `src/app/(public)/bookings/[publicId]/calendar.ics/route.ts`:

```ts
import { getPublicBooking } from "@/server";
import { publicLink } from "@/server/share";
import { bookingView } from "@/utils/booking-view";
import { bookingIcs } from "@/utils/ics";

/** "Add to calendar" on a booking page: one event, for a booking still to come. */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await params;
  const booking = await getPublicBooking(publicId).catch(() => null);
  if (!booking || bookingView(booking) !== "upcoming") {
    return new Response("Not found", { status: 404 });
  }
  return new Response(bookingIcs(booking, { url: publicLink("booking", booking.publicId) }), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="booking.ics"',
      "cache-control": "no-store",
    },
  });
}
```

Run: `yarn test "src/app/(public)/bookings"`
Expected: PASS.

- [ ] **Step 3: Add the booking card**

In `src/server/og.tsx`, add to the imports `import { bookingPill, type BookingView, type PublicBooking } from "@/utils/booking-view";` and extend the format import to `import { dayMonth, formatMoney, formatSlotTime, unitCount } from "@/utils/format";`. Append:

```tsx
/*
 * A booking link's card, laid out like the service and document cards: the
 * business, the service and its status on the left with Sara's quiet
 * signature; on the right a calendar leaf on leaf grey, because the date is
 * what the customer opens it for. Never the customer's name or the amount:
 * cards get forwarded into group chats.
 */
export async function bookingCard(booking: PublicBooking, view: BookingView) {
  const pill = bookingPill(view);
  const mode = booking.service.bookingMode;
  const titleSize = booking.service.name.length > 28 ? 60 : 76;
  const start = new Date(booking.startTime);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(start);

  const leaf =
    mode === "SLOT" ? (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: 420,
          borderRadius: 32,
          background: OG.surface,
        }}
      >
        <div style={{ fontFamily: "Hanken", fontWeight: 600, fontSize: 26, color: OG.muted }}>
          {`${part({ weekday: "long" })} · ${part({ month: "long" })}`}
        </div>
        <div
          style={{
            fontFamily: "Bricolage",
            fontSize: 200,
            lineHeight: 1,
            letterSpacing: -8,
            color: OG.ink,
            marginTop: 8,
          }}
        >
          {String(start.getUTCDate())}
        </div>
        <div style={{ fontFamily: "Hanken", fontSize: 30, color: OG.ink, marginTop: 12 }}>
          {formatSlotTime(booking.startTime)}
        </div>
      </div>
    ) : (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width: 420,
          padding: 48,
          borderRadius: 32,
          background: OG.surface,
        }}
      >
        <div style={{ fontFamily: "Bricolage", fontSize: 56, lineHeight: 1.05, color: OG.ink }}>
          {dayMonth(booking.startTime)}
        </div>
        <div style={{ fontFamily: "Hanken", fontSize: 26, color: OG.muted, margin: "6px 0" }}>
          to
        </div>
        <div style={{ fontFamily: "Bricolage", fontSize: 56, lineHeight: 1.05, color: OG.ink }}>
          {dayMonth(booking.endTime)}
        </div>
        <div
          style={{
            fontFamily: "Hanken",
            fontWeight: 600,
            fontSize: 26,
            color: OG.muted,
            marginTop: 24,
          }}
        >
          {unitCount(mode, booking.units)}
        </div>
      </div>
    );

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: OG.canvas,
        padding: 64,
        gap: 56,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flex: 1,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontFamily: "Hanken", fontWeight: 600, fontSize: 28, color: OG.muted }}>
            {clip(booking.businessName, 36)}
          </div>
          <div
            style={{
              fontFamily: "Bricolage",
              fontSize: titleSize,
              lineHeight: 1.04,
              letterSpacing: -0.035 * titleSize,
              color: OG.ink,
            }}
          >
            {clip(booking.service.name, 48)}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              height: 60,
              padding: "0 28px",
              borderRadius: 999,
              ...PILL[pill.tone],
              fontFamily: "Hanken",
              fontWeight: 600,
              fontSize: 26,
            }}
          >
            {pill.label}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontFamily: "Hanken",
              fontSize: 22,
              color: OG.faint,
            }}
          >
            Bookings by
            <OgLockup size={30} color={OG.faint} accent={OG.faint} />
          </div>
        </div>
      </div>

      {leaf}
    </div>,
    { ...OG_SIZE, fonts: await ogFonts() },
  );
}
```

(`PILL` and `clip` already exist above `documentCard`; place this after them. `formatMoney` stays in the import: `documentCard` uses it.)

- [ ] **Step 4: Build the page component**

Create `src/components/public/booking-page.tsx`:

```tsx
import type { ReactNode } from "react";

import { AwaitConfirmation } from "@/components/book/await-confirmation";
import { PublicPage } from "@/components/public/public-page";
import { Button, StatusPill } from "@/primitives";
import {
  bookingPill,
  type BookingView,
  type PublicBooking,
} from "@/utils/booking-view";
import { formatMoney, formatSlotTime, shortDay, unitCount } from "@/utils/format";
import { publicPath } from "@/utils/public-links";

const LINE: Partial<Record<BookingView, string>> = {
  released: "Payment didn't come through, so this time was released.",
  cancelled: "This booking was cancelled.",
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted shrink-0">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Half({ label, day, time }: { label: string; day: string; time: string }) {
  return (
    <div>
      <p className="text-muted text-sm font-semibold">{label}</p>
      <p className="font-display mt-1 text-[22px] leading-[1.2] font-medium tracking-[-0.02em]">
        {day}
      </p>
      <p className="text-muted mt-0.5 text-[15px]">{time}</p>
    </div>
  );
}

/** The booking's time, read like a calendar leaf: one day, or two halves and a length. */
function When({ booking }: { booking: PublicBooking }) {
  const mode = booking.service.bookingMode;
  if (mode === "SLOT") {
    return (
      <div>
        <p className="font-display text-[clamp(2.4rem,1.8rem+2.2vw,3.4rem)] leading-none font-[330] tracking-[-0.035em]">
          {shortDay(booking.startTime)}
        </p>
        <p className="text-ink-2 mt-3 text-[17px]">
          {formatSlotTime(booking.startTime)} to {formatSlotTime(booking.endTime)}
        </p>
      </div>
    );
  }
  const stay = mode === "NIGHTLY";
  return (
    <div>
      <div className="grid grid-cols-2 gap-4">
        <Half
          label={stay ? "Check-in" : "Pickup"}
          day={shortDay(booking.startTime)}
          time={stay ? `From ${formatSlotTime(booking.startTime)}` : formatSlotTime(booking.startTime)}
        />
        <Half
          label={stay ? "Check-out" : "Return"}
          day={shortDay(booking.endTime)}
          time={stay ? `By ${formatSlotTime(booking.endTime)}` : formatSlotTime(booking.endTime)}
        />
      </div>
      <p className="text-accent-ink mt-4 text-[15px] font-semibold">
        {unitCount(mode, booking.units)}
      </p>
    </div>
  );
}

/**
 * The page behind a customer's booking link: what, when and where, whether
 * it's paid, and the one thing to do next (add it to a calendar, or book
 * again). Laid out like the invoice and receipt pages.
 */
export function PublicBookingPage({ booking, view }: { booking: PublicBooking; view: BookingView }) {
  const pill = bookingPill(view);
  const money = formatMoney(booking.amount, booking.currency);
  const paid = booking.status === "CONFIRMED" || booking.status === "COMPLETED";
  const bookAgain = `/book/${encodeURIComponent(booking.service.slug)}`;
  const showReceipt = booking.receiptPath && (view === "upcoming" || view === "past" || view === "done");

  const actions: ReactNode[] = [];
  if (view === "upcoming") {
    actions.push(
      <Button key="calendar" asChild size="lg" className="w-full sm:w-auto">
        <a href={`${publicPath("booking", booking.publicId)}/calendar.ics`} download>
          Add to calendar
        </a>
      </Button>,
    );
  }
  if (view === "released" || view === "cancelled") {
    actions.push(
      <Button key="again" asChild size="lg" className="w-full sm:w-auto">
        <a href={bookAgain}>Book again</a>
      </Button>,
    );
  }
  if (showReceipt) {
    actions.push(
      <Button key="receipt" asChild size="lg" variant="secondary" className="w-full shadow-none sm:w-auto">
        <a href={booking.receiptPath!}>View receipt</a>
      </Button>,
    );
  }
  if (view === "past" || view === "done") {
    actions.push(
      <Button key="again" asChild size="lg" variant="secondary" className="w-full shadow-none sm:w-auto">
        <a href={bookAgain}>Book again</a>
      </Button>,
    );
  }

  return (
    <PublicPage businessName={booking.businessName} credit="Bookings">
      <section aria-labelledby="booking-h" className="animate-rise pt-4 lg:pt-12">
        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
        <h1
          id="booking-h"
          className="font-display mt-4 text-[clamp(2.1rem,1.4rem+3vw,3.4rem)] leading-[1.04] font-[380] tracking-[-0.035em] text-balance"
        >
          {booking.service.name}
        </h1>
        <p className="text-muted mt-3 text-pretty">
          With {booking.businessName}. Booked for {booking.clientName}.
        </p>
      </section>

      <section
        aria-label="When and where"
        className="rounded-panel bg-surface animate-rise-2 mt-8 px-5 py-6 sm:px-6"
      >
        <When booking={booking} />
        {booking.businessAddress || paid || view === "held" ? (
          <dl className="border-line mt-6 space-y-2 border-t pt-5 text-[15px]">
            {booking.businessAddress ? <Fact label="Where">{booking.businessAddress}</Fact> : null}
            {paid ? <Fact label="Paid">{money}</Fact> : null}
            {view === "held" ? <Fact label="To pay">{money}</Fact> : null}
          </dl>
        ) : null}
      </section>

      {view === "held" ? (
        <div className="animate-rise-3 mt-8 grid gap-3">
          <p className="text-muted max-w-[52ch] text-pretty">
            We&apos;re confirming your payment. Your time is held for 30 minutes.
          </p>
          <AwaitConfirmation />
        </div>
      ) : LINE[view] ? (
        <p className="text-muted animate-rise-3 mt-8 max-w-[52ch] text-pretty">{LINE[view]}</p>
      ) : null}

      {actions.length > 0 ? (
        <div className="animate-rise-3 mt-8 flex flex-col gap-3 sm:flex-row">{actions}</div>
      ) : null}
    </PublicPage>
  );
}
```

- [ ] **Step 5: Create the booking routes**

Create `src/app/(public)/bookings/[publicId]/page.tsx`:

```tsx
import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicError } from "@/components/public-error";
import { PublicBookingPage } from "@/components/public/booking-page";
import { getPublicBooking } from "@/server";
import { bookingMetadata, bookingView } from "@/utils/booking-view";
import { publicPath } from "@/utils/public-links";

type Params = { params: Promise<{ publicId: string }> };

// Payments, reschedules and cancellations land after the link is sent.
export const dynamic = "force-dynamic";

/** The booking link in the customer's emails (server/share.ts). Card: ./opengraph-image.tsx. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { publicId } = await params;
  const booking = await getPublicBooking(publicId).catch(() => null);
  return bookingMetadata(booking, publicPath("booking", publicId));
}

export default async function BookingPublicPage({ params }: Params) {
  const { publicId } = await params;

  let booking;
  try {
    booking = await getPublicBooking(publicId);
  } catch (error) {
    console.error("[bookings] failed to load booking:", error);
    return (
      <PublicError
        title="This booking didn't load."
        body="Something went wrong on our side. Refresh the page to try again."
      />
    );
  }

  if (!booking) notFound();

  return <PublicBookingPage booking={booking} view={bookingView(booking)} />;
}
```

Create `src/app/(public)/bookings/[publicId]/opengraph-image.tsx`:

```tsx
import { getPublicBooking } from "@/server";
import { bookingCard, pageCard } from "@/server/og";
import { bookingView } from "@/utils/booking-view";
import { OG_SIZE } from "@/utils/metadata";

/* A booking link's share card: its date as a calendar leaf. Unknown ids get the site card. */

export const alt = "Your booking";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ publicId: string }> };

export default async function BookingPublicOpenGraphImage({ params }: Params) {
  const { publicId } = await params;
  const booking = await getPublicBooking(publicId).catch(() => null);
  return booking ? bookingCard(booking, bookingView(booking)) : pageCard("site");
}
```

Create `src/app/(public)/bookings/[publicId]/not-found.tsx`:

```tsx
import { PublicError } from "@/components/public-error";

export default function BookingPublicNotFound() {
  return (
    <PublicError
      title="We couldn't find that booking."
      body="Check the link in your confirmation email, or ask the business to send it again."
    />
  );
}
```

Create `src/app/(public)/bookings/[publicId]/loading.tsx`:

```tsx
import { PublicDetailSkeleton } from "@/components/public/detail-skeleton";

export default function BookingPublicLoading() {
  return <PublicDetailSkeleton />;
}
```

- [ ] **Step 6: Typecheck, test, build**

Run: `npx tsc --noEmit && yarn test && npx next build --no-lint`
Expected: all pass; the route table shows `ƒ /bookings/[publicId]`, its `opengraph-image` and `ƒ /bookings/[publicId]/calendar.ics` beside `/bookings`.

Run: `npx eslint src/server/og.tsx src/components/public/booking-page.tsx "src/app/(public)/bookings"`
Expected: no errors.

- [ ] **Step 7: Design pre-flight (impeccable craft floor + taste v2)**

Run:

```bash
grep -n "—\|–" src/components/public/booking-page.tsx "src/app/(public)/bookings/[publicId]/"*.tsx src/utils/booking-view.ts
grep -nE "#[0-9a-fA-F]{3,8}\b" src/components/public/booking-page.tsx
```

Expected: no output from either.

Read `booking-page.tsx` against the craft floor and check each view of the table in the spec: exactly one primary (green) button per view (upcoming: Add to calendar; released/cancelled: Book again; past/done/held: none); the held view polls via `AwaitConfirmation` and shows no buttons; "Where" is absent without an address. If a database is reachable, open a booking in each state at 375px and 1280px, download the `.ics` and import it into a calendar app, and fetch `/bookings/<id>/opengraph-image` for a slot and a stay; fix what the checks show in one batch.

- [ ] **Step 8: Commit**

```bash
git add src/server/og.tsx src/components/public/booking-page.tsx "src/app/(public)/bookings"
git commit -m "feat: public booking page at /bookings/<id> with its card and calendar file"
```

---

### Task 8: Booking links in customer emails and after checkout

**Files:**
- Modify: `src/backend/services/email/templates/BookingConfirmedEmail.tsx`, `BookingReminderEmail.tsx`, `BookingRescheduledEmail.tsx`
- Modify: `src/backend/services/email/messages.tsx` (`bookingConfirmedEmail`, `bookingReminderEmail`, `bookingRescheduledEmail`)
- Modify: `src/app/api/webhooks/paystack/route.ts` (booking `select` and the confirmation email call)
- Modify: `src/app/api/cron/booking-reminders/route.ts:57-67`
- Modify: `src/app/api/bookings/[slug]/route.ts:245-260`
- Modify: `src/server/book.ts` (`getBookingReceipt`), `src/app/book/[slug]/done/page.tsx`
- Test: `src/backend/services/email/messages.test.tsx`, `src/backend/services/email/index.test.ts`, `src/app/api/webhooks/paystack/route.test.ts`, `src/app/api/cron/booking-reminders/route.test.ts`, `src/app/api/bookings/[slug]/route.test.ts`

**Interfaces:**
- Consumes: `publicLink`, `publicPath` (Task 2); `Booking.publicId` (Task 2); the booking page (Task 7).
- Produces: `bookingConfirmedEmail`, `bookingReminderEmail`, `bookingRescheduledEmail` (and the matching `emailService.send*` methods, whose input types derive from them) each require `bookingUrl: string`. `getBookingReceipt` also returns `publicId: string`.

- [ ] **Step 1: Write the failing email tests**

In `src/backend/services/email/messages.test.tsx`, add `bookingUrl: "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",` to every `bookingConfirmedEmail({...})`, `bookingReminderEmail({...})` and `bookingRescheduledEmail({...})` input in the file, then add to the `customer emails` describe:

```ts
  it("links the customer's booking page from the confirmation, reminder and move", async () => {
    const bookingUrl = "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t";
    const confirmed = await rendered(
      bookingConfirmedEmail({
        origin,
        to: "ada@example.com",
        business,
        serviceName: "Braids",
        startTime: at,
        duration: 240,
        amount: 25000,
        currency: "NGN",
        receiptUrl: "https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE",
        bookingUrl,
      }),
    );
    expect(confirmed.html).toContain(`href="${bookingUrl}"`);
    expect(confirmed.text).toContain("View your booking");
    expect(confirmed.html).toContain('href="https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE"');

    const reminder = await rendered(
      bookingReminderEmail({ origin, to: "ada@example.com", business, serviceName: "Braids", startTime: at, bookingUrl }),
    );
    expect(reminder.html).toContain(`href="${bookingUrl}"`);

    const moved = await rendered(
      bookingRescheduledEmail({
        origin,
        to: "ada@example.com",
        business,
        serviceName: "Braids",
        previousStartTime: at,
        newStartTime: new Date("2026-10-03T10:00:00.000Z"),
        bookingUrl,
      }),
    );
    expect(moved.html).toContain(`href="${bookingUrl}"`);
  });
```

In `src/backend/services/email/index.test.ts`, add `bookingUrl: "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",` to the `CONFIRMATION` fixture and to the `sendBookingReminderEmail({...})` input.

Run: `yarn test src/backend/services/email`
Expected: FAIL — the new test's `href` assertions fail (no booking link is rendered).

- [ ] **Step 2: Add the link to the templates**

`BookingConfirmedEmail.tsx`:
- Import `Link` from `@react-email/components` (add `import { Link } from "@react-email/components";` above the Layout import).
- Add to the props interface:

```ts
  /** The customer's booking page. */
  bookingUrl: string;
```

- Destructure `bookingUrl` and replace the `receiptUrl ? <CtaButton …>View your receipt</CtaButton> : null` block with:

```tsx
      <CtaButton href={bookingUrl}>View your booking</CtaButton>
      {receiptUrl ? (
        <Paragraph>
          <Link href={receiptUrl} className="text-ink-2 underline">
            View your receipt
          </Link>
        </Paragraph>
      ) : null}
```

- Add `bookingUrl: "https://sara.app/bookings/Pq8sN1xV0kL3mA6t",` to `PreviewProps`.

`BookingReminderEmail.tsx`:
- Add `CtaButton` to the Layout import list.
- Add `bookingUrl: string;` (with the doc comment `/** The customer's booking page. */`) to the props, destructure it, and insert after the `<Details …/>` element:

```tsx
      <CtaButton href={bookingUrl}>View your booking</CtaButton>
```

- Add `bookingUrl: "https://sara.app/bookings/Pq8sN1xV0kL3mA6t",` to `PreviewProps`.

`BookingRescheduledEmail.tsx`: the same three changes as the reminder (import `CtaButton`, prop + destructure + the `CtaButton` after `<Details …/>`, preview prop).

- [ ] **Step 3: Thread the link through the builders**

In `src/backend/services/email/messages.tsx`:
- `bookingConfirmedEmail` input: after `receiptUrl: string | null;` add `bookingUrl: string;`, and pass `bookingUrl={input.bookingUrl}` to `<BookingConfirmedEmail …>`.
- `bookingReminderEmail` input: after `span?: BookingSpanInput;` add `bookingUrl: string;`, and pass `bookingUrl={input.bookingUrl}` to `<BookingReminderEmail …>`.
- `bookingRescheduledEmail` input: after `previousSpan?: BookingSpanInput;` add `bookingUrl: string;`, and pass `bookingUrl={input.bookingUrl}` to `<BookingRescheduledEmail …>`.

Run: `yarn test src/backend/services/email`
Expected: PASS.

- [ ] **Step 4: Write the failing sender tests**

`src/app/api/webhooks/paystack/route.test.ts`: add `publicId: "Pq8sN1xV0kL3mA6t",` to the `BOOKING` fixture, and in the first test's `sendBookingConfirmationEmail` expectation add:

```ts
        bookingUrl: expect.stringMatching(/\/bookings\/Pq8sN1xV0kL3mA6t$/),
```

`src/app/api/cron/booking-reminders/route.test.ts`: in "sends a reminder and marks reminderSentAt for each due booking", add `publicId: "Pq8sN1xV0kL3mA6t",` to the `booking` object and change the email expectation to:

```ts
    expect(mockedEmail.sendBookingReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: booking.clientEmail,
        bookingUrl: expect.stringMatching(/\/bookings\/Pq8sN1xV0kL3mA6t$/),
      }),
    );
```

`src/app/api/bookings/[slug]/route.test.ts`: add `publicId: "Pq8sN1xV0kL3mA6t",` to `EXISTING_BOOKING`, and in "sends a reschedule email when startTime/endTime change" add to the `objectContaining`:

```ts
        bookingUrl: expect.stringMatching(/\/bookings\/Pq8sN1xV0kL3mA6t$/),
```

Run: `yarn test src/app/api/webhooks/paystack src/app/api/cron src/app/api/bookings`
Expected: FAIL — `bookingUrl` is missing from the three calls.

- [ ] **Step 5: Pass the link from the three senders**

`src/app/api/webhooks/paystack/route.ts` (it already imports `publicLink` since Task 3): in the booking `select`, after `id: true,` add `publicId: true,`; in the `sendBookingConfirmationEmail({...})` call, after `receiptUrl,` add:

```ts
        bookingUrl: publicLink("booking", booking.publicId),
```

`src/app/api/cron/booking-reminders/route.ts`: add `import { publicLink } from "@/server/share";` and, in the `sendBookingReminderEmail({...})` call after `startTime: booking.startTime,`, add:

```ts
              bookingUrl: publicLink("booking", booking.publicId),
```

`src/app/api/bookings/[slug]/route.ts`: add `import { publicLink } from "@/server/share";` and, in the `sendBookingRescheduledEmail({...})` call after `newStartTime: updatedBooking.startTime,`, add:

```ts
              bookingUrl: publicLink("booking", updatedBooking.publicId),
```

Run: `yarn test src/app/api && npx tsc --noEmit`
Expected: PASS; typecheck clean (tsc will name any other caller of the three senders that lacks `bookingUrl`; add `bookingUrl: publicLink("booking", <booking>.publicId)` there the same way).

- [ ] **Step 6: Link the booking page after checkout**

In `src/server/book.ts`, in `getBookingReceipt`'s `select` add `publicId: true,` and in its return object add `publicId: booking.publicId,`.

In `src/app/book/[slug]/done/page.tsx`, add `import { publicPath } from "@/utils/public-links";` and replace the confirmed branch's single child (the `<p …>✅ …</p>`) with:

```tsx
      <>
        <p className="rounded-bubble border-line bg-canvas shadow-bubble w-fit max-w-full rounded-bl-[6px] border px-3.5 py-2.5 text-[14.5px] leading-normal">
          ✅ {booking.serviceName} with {booking.businessName}, {when}. Paid.
        </p>
        <div className="mt-6">
          <Button asChild variant="secondary">
            <a href={publicPath("booking", booking.publicId)}>View your booking</a>
          </Button>
        </div>
      </>
```

- [ ] **Step 7: Typecheck, test, lint**

Run: `npx tsc --noEmit && yarn test`
Expected: PASS.

Run: `npx eslint src/backend/services/email src/app/api/webhooks/paystack/route.ts src/app/api/cron/booking-reminders/route.ts "src/app/api/bookings/[slug]/route.ts" src/server/book.ts "src/app/book/[slug]/done/page.tsx"`
Expected: no new errors in the lines this task changed (these files may carry pre-existing `catch (error: any)` lint; leave those).

Optional, if useful: `yarn email:dev` and open the three templates to see the new button and link.

- [ ] **Step 8: Commit**

```bash
git add src/backend/services/email src/app/api/webhooks/paystack src/app/api/cron/booking-reminders "src/app/api/bookings/[slug]" src/server/book.ts "src/app/book/[slug]/done/page.tsx"
git commit -m "feat: link the customer's booking page from emails and after checkout"
```

---

### Task 9: Copy-link buttons on the owner's invoice, receipt and booking rows

**Files:**
- Modify: `src/app/components/landing/CopyLinkButton.tsx`
- Modify: `src/components/bookings/booking-row.tsx`, `src/components/bookings/bookings-page-client.tsx`, `src/app/(app)/bookings/page.tsx`
- Modify: `src/components/invoices/invoice-row.tsx`, `src/components/invoices/invoices-page-client.tsx`, `src/app/(app)/invoices/page.tsx`
- Modify: `src/components/receipts/receipts-page-client.tsx`, `src/app/(app)/receipts/page.tsx`

**Interfaces:**
- Consumes: `publicPath` (Task 2); `publicId` on `BookingDto`, `InvoiceDto`, `ReceiptDto` (arrives with the Task 2 columns through `Serialized<Model>`).
- Produces: `CopyLinkButton({ url, label?, tone?, className? })` with `label` default `"Copy"`, `tone: "dark" | "quiet"` default `"dark"`. `BookingRow` and `InvoiceRow` gain a `link: string` prop; `BookingsPageClient`, `InvoicesPageClient`, `ReceiptsPageClient` gain `publicBaseUrl: string`.

There is no component test harness in this repo (Vitest runs in `node`); this task is verified by typecheck, lint and, when a database is available, by eye.

- [ ] **Step 1: Let the copy button be quiet and say what it copies**

In `src/app/components/landing/CopyLinkButton.tsx`, replace the signature line `export function CopyLinkButton({ url }: { url: string }) {` with:

```tsx
const IDLE = {
  dark: "bg-ink text-canvas hover:bg-accent-ink",
  quiet: "border border-line bg-canvas text-ink hover:border-ink",
} as const;

export function CopyLinkButton({
  url,
  label = "Copy",
  tone = "dark",
  className,
}: {
  url: string;
  /** The resting label; "Copied" and the fallback hint replace it briefly. */
  label?: string;
  /** "quiet" for rows where it sits beside other actions. */
  tone?: keyof typeof IDLE;
  className?: string;
}) {
```

and in the returned `<button>`, change the `cn(...)` call and the label to:

```tsx
      className={cn(
        "ease-out-expo h-[38px] flex-none cursor-pointer rounded-full px-[18px] text-sm font-semibold transition-[background-color,border-color,scale] duration-200 active:scale-97",
        state === "idle" ? IDLE[tone] : "bg-accent text-on-accent",
        className,
      )}
```

```tsx
      {state === "idle" ? label : LABEL[state]}
```

(Existing callers pass only `url` and render exactly as before.)

- [ ] **Step 2: Bookings**

`src/app/(app)/bookings/page.tsx`: add `import { appBaseUrl } from "@/utils/url";` and pass `publicBaseUrl={appBaseUrl()}` to `<BookingsPageClient …>`.

`src/components/bookings/bookings-page-client.tsx`: add `publicBaseUrl: string;` to `BookingsPageClientProps`, destructure it, add `import { publicPath } from "@/utils/public-links";`, and pass to `<BookingRow …>`:

```tsx
                link={`${publicBaseUrl}${publicPath("booking", booking.publicId)}`}
```

`src/components/bookings/booking-row.tsx`: add `import { CopyLinkButton } from "@/app/components/landing/CopyLinkButton";`, add `link: string;` (doc comment `/** The customer's booking page. */`) to `BookingRowProps` and destructure it. Replace the actions block `{isOpen ? (<div className="flex flex-wrap gap-2 sm:justify-end">…</div>) : null}` with an always-present container:

```tsx
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <CopyLinkButton url={link} label="Copy link" tone="quiet" className="h-10" />
        {isOpen ? (
          <>
            {/* the existing Confirm / Mark done, Reschedule and Cancel buttons, unchanged */}
          </>
        ) : null}
      </div>
```

moving the existing buttons, unchanged, inside the fragment.

- [ ] **Step 3: Invoices**

`src/app/(app)/invoices/page.tsx`: add `import { appBaseUrl } from "@/utils/url";` and pass `publicBaseUrl={appBaseUrl()}` to `<InvoicesPageClient …>`.

`src/components/invoices/invoices-page-client.tsx`: add `publicBaseUrl: string;` to the props interface, destructure it, add `import { publicPath } from "@/utils/public-links";`, and pass to `<InvoiceRow …>`:

```tsx
                link={`${publicBaseUrl}${publicPath("invoice", invoice.publicId)}`}
```

`src/components/invoices/invoice-row.tsx`: add the `CopyLinkButton` import, add `link: string;` (doc comment `/** The customer's invoice page. */`) to `InvoiceRowProps`, destructure it, and insert before the `{invoice.url ? (<Button …>PDF</Button>) : null}` block:

```tsx
        <CopyLinkButton url={link} label="Copy link" tone="quiet" className="h-10" />
```

- [ ] **Step 4: Receipts**

`src/app/(app)/receipts/page.tsx`: add `import { appBaseUrl } from "@/utils/url";` and pass `publicBaseUrl={appBaseUrl()}` to `<ReceiptsPageClient …>`.

`src/components/receipts/receipts-page-client.tsx`: add `publicBaseUrl: string;` to `ReceiptsPageClientProps`, destructure it, add `import { CopyLinkButton } from "@/app/components/landing/CopyLinkButton";` and `import { publicPath } from "@/utils/public-links";`, and insert before the `{receipt.url ? (<Button …>PDF</Button>) : null}` block in each row:

```tsx
                <CopyLinkButton
                  url={`${publicBaseUrl}${publicPath("receipt", receipt.publicId)}`}
                  label="Copy link"
                  tone="quiet"
                  className="h-10"
                />
```

- [ ] **Step 5: Typecheck, test, lint, build**

Run: `npx tsc --noEmit && yarn test && npx next build --no-lint`
Expected: all pass.

Run: `npx eslint src/app/components/landing/CopyLinkButton.tsx src/components/bookings src/components/invoices src/components/receipts "src/app/(app)/bookings/page.tsx" "src/app/(app)/invoices/page.tsx" "src/app/(app)/receipts/page.tsx"`
Expected: no errors.

If a database is reachable, sign in and check each list at 375px: the "Copy link" pill sits with the row's other actions, wraps cleanly, turns green with "Copied" when pressed, and the copied URL opens the right public page.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/landing/CopyLinkButton.tsx src/components/bookings src/components/invoices src/components/receipts "src/app/(app)/bookings/page.tsx" "src/app/(app)/invoices/page.tsx" "src/app/(app)/receipts/page.tsx"
git commit -m "feat: copy-link buttons for each invoice, receipt and booking's public page"
```

---

### Task 10: Docs and the full verification run

**Files:**
- Modify: `PRODUCT.md` (Operating Context, "Booking links" bullet)
- Modify: `DESIGN.md` (Components › Logo, "Share cards" bullet)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new.

- [ ] **Step 1: Update PRODUCT.md**

Replace the bullet that starts `- Booking links: \`app.sara.ng/book/<service-slug>\`` with:

```markdown
- Customer links: the chat shares a service's page, `app.sara.ng/services/<service-slug>` (e.g. `app.sara.ng/services/tobi-knotless-braids`), whose "Book a time" opens the booking page at `app.sara.ng/book/<service-slug>`. Invoices, receipts and bookings each have a customer page at `/invoices/<id>`, `/receipts/<id>` and `/bookings/<id>` (random ids). Service labels: "Knotless braids — NGN 25,000 (4 hr)".
```

- [ ] **Step 2: Update DESIGN.md**

Replace the bullet that starts `- **Share cards**:` with:

```markdown
- **Share cards**: built in `src/server/og.tsx` with the app's own fonts from `assets/fonts`: the site card (`app/opengraph-image.tsx`); `serviceCard` for a service's booking link and page (`/book/[slug]`, `/services/[slug]`); `documentCard` for invoices and receipts; `bookingCard` for a booking, its date drawn as a calendar leaf. Each customer page wears its own; unknown links fall back to the site card.
```

- [ ] **Step 3: Full verification run**

Run each and record the result in the task report:

```bash
npx tsc --noEmit
yarn test
npx next build --no-lint
git diff --name-only main...HEAD -- '*.ts' '*.tsx' | xargs npx eslint
grep -rn "isShareKey\|sharePath\|shareUrl(" src
grep -rln "—\|–" src/components/public "src/app/(public)" src/utils/service-page.ts src/utils/booking-view.ts
```

Expected: typecheck, tests and build pass; eslint reports no errors in lines this branch added (pre-existing `catch (error: any)` warnings in untouched lines are known); both greps print nothing.

If a database is reachable (`./start-database.sh`, then `npx prisma migrate deploy`), run the app (`yarn dev`, or the `run` skill) and check:
- `/services/<slug>`, `/invoices/<id>`, `/receipts/<id>`, `/bookings/<id>` at 375px and 1280px.
- `curl -s -A "WhatsApp/2.23.20.0 A" http://localhost:3000/bookings/<id> | grep -o '<meta property="og:[^>]*>'` shows the booking's title, description and its own `opengraph-image` URL; repeat for the other three.
- Each `…/opengraph-image` URL returns a PNG that matches the spec's card description.
- `curl -s -A "WhatsApp/2.23.20.0 A" http://localhost:3000/invoices` still returns the owner "Invoices · Sara" card, and `/i/<anything>` returns 404.

Without a database, state that the live checks were not run.

- [ ] **Step 4: Commit**

```bash
git add PRODUCT.md DESIGN.md
git commit -m "docs: record the customer pages and their share cards"
```

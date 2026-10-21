# Merchants: Products, Orders and Customers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Sara businesses sell products with options and stock through a shareable link, turn every paid sale into an order the owner fulfils, keep one customer list per business, and let customers pay invoices online.

**Architecture:** New Prisma models: `Customer`, `Product`, `ProductOption`, `Order` and `OrderLine`. Invoice and receipt lines move to general `InvoiceLine` and `ReceiptLine` tables that can point at a service or a product option. Business logic lives in class-singleton services under `src/backend/services/{customer,product,order,lines}`. Thin `withMiddleware` routes call those services, and the existing Paystack webhook dispatches to them by the transaction's metadata. Owner screens follow the existing pattern: a server page, a `*-page-client.tsx`, TanStack Query hooks and `api.*` methods. Customer pages follow the `/services/<slug>` and `/bookings/<publicId>` pattern.

**Tech Stack:** Next.js 15 App Router, Prisma 6 on Postgres, zod 4, TanStack Query 5, Tailwind v4 tokens, vitest 4 with a mocked `@/server/db`, Paystack, Resend with react-email, the WhatsApp Cloud API.

**Spec:** `docs/superpowers/specs/2026-10-21-merchants-products-orders-customers-design.md`

## Before you start

- At planning time, `src/utils/api.ts`, `src/app/components/landing/LandingPage.tsx` and `src/app/components/landing/WhatsAppChat.tsx` have uncommitted changes that belong to the owner. Ask the owner to commit or stash them before Task 1. Never overwrite them.
- Work on branch `feat/merchants-and-voice-notes`.
- Start the local database with `docker compose up -d postgres`. It's needed for every migration step.

## Global Constraints

- All UI follows `DESIGN.md`. Use Tailwind token classes only (`bg-canvas`, `text-ink`, `bg-accent text-on-accent`, `text-accent-ink`, `rounded-panel`, `shadow-float`, `font-display`, …), composed with `cn()` from `@/utils/cn`. No CSS modules and no inline `style` for design values. Accent green is a fill only, with `on-accent` text on it.
- Design phone-first: every new screen must work at 375px.
- Money in UI chrome reads "NGN 15,000"; in headline and stat copy it reads "₦15,000". Chat and email text use `formatMoney(amount, currency)` from `src/backend/services/messaging/engine/amount.ts`, which gives "NGN 45,000".
- Payments go through the Paystack split into the business's subaccount, using `paystackService.initializeTransaction`. The amount is in kobo (`Math.round(amount * 100)`). The fallback payer email is `"customer@sara.app"`, as for bookings.
- Unpaid online checkouts hold stock for 30 minutes. Reuse `HOLD_MINUTES` and `holdExpiresFrom` from `src/backend/services/booking/conflicts.ts`.
- Customers only ever get email from Sara, never WhatsApp.
- Low stock means 3 or fewer left of an option on a product that tracks stock.
- Order numbers run `ORD-1001` upward per business. Every order also has a `publicId` (`nanoid(16)`).
- A product has at most 5 photos. The first one is the link card image.
- Customer URLs: `/products/<slug>` and `/orders/<publicId>`. Checkout is a sheet on the product page, not a page of its own.
- UI tasks build to the UI direction section below, using the impeccable skill (v4.7.0; the project copy is at `.agents/skills/impeccable`).
  - Invoke it before editing UI, so it loads PRODUCT.md, DESIGN.md and its craft rules.
  - When a task's screens are built, run `.agents/skills/impeccable/scripts/impeccable detect --json <changed .tsx files>` once and fix what it reports.
- Routes use `withMiddleware(handler, [authMiddleware, bodyValidatorMiddleware(schema) | queryValidatorMiddleware(schema)])`.
  - Responses are `ApiResponse<T>` or `PaginatedApiResponse<T>` from `types`.
  - Errors are thrown from `@/utils/exceptions`.
  - Each route has an OpenAPI JSDoc block (`@description`, `@body`, `@queryParams`, `@auth bearer`), modelled on `src/app/api/services/route.ts`.
- Tests mock `@/server/db` with `vi.mock`, as in `src/backend/services/receipt/index.test.ts`. Route tests use `createMockRequest` from `src/backend/test-utils/mock-request.ts`.
  - Run one area with `yarn test <path>` and everything with `yarn test`.
  - `yarn typecheck` and `yarn lint` must be clean before every commit.
- Migrations: `yarn prisma migrate dev --create-only --name <name>`, edit the SQL, then `yarn prisma migrate dev`.
- Commit messages are conventional (`feat(scope): …`, `test: …`). Never add "Co-Authored-By: Claude", "Generated with Claude Code" or any similar line.
- `docs/` is gitignored, so docs are force-added with `git add -f`.
- A business that only sells services must behave exactly as before. The only differences are the customer list and the Pay button on invoices.

## Review Focus

1. **A payment arrives after its hold expired and the last item has since sold.** The order still becomes paid (NEW) with `oversold: true`, stock ends at 0 (never negative) and the owner alert says so. Tested in Task 14.
2. **Paystack delivers the same `charge.success` twice**, from the webhook and the callback verification racing. The result is one order, one Payment, one receipt, and stock taken once. Tested in Task 14 for orders and Task 21 for invoices.
3. **One phone typed four ways** ("0803 555 0142", "+234 803 555 0142", "2348035550142", "08035550142") resolves to one customer. Tested in Task 2.
4. **A product is paused, or an option removed, while a customer has the checkout sheet open.** The checkout request fails with "This product is no longer available", and orders that already exist still show the name snapshot. Tested in Task 13 (checkout) and Task 16 (order page).
5. **An invoice that lists products gets two part payments.** The order is created and stock taken once, on the first payment. Tested in Task 20.

## UI direction

This was shaped with impeccable 4.7.0 on 2026-10-21. The owner chose:
- checkout in a sheet on the product page
- order actions on the order row
- square, swipeable product photos on phones.

**World.** Inherit `DESIGN.md` as it is: no new tokens and no `DESIGN.md` changes. Every new screen extends a sibling that already ships. Copy the sibling's composition, then change only what the new content needs.

| New surface | Copy from |
| --- | --- |
| Customers list | `src/components/bookings/bookings-page-client.tsx` (header, rows, `Pager`) |
| Customer page | `Panel` sections and the Today page's `Stat` |
| Products screen | `src/components/services/services-page-client.tsx` and `service-card.tsx` |
| Product editor | `src/components/services/service-modal.tsx` (a bottom sheet on phones) |
| Orders screen | `bookings-page-client.tsx` and `src/components/bookings/booking-row.tsx` (actions on the row) |
| Selling settings | `src/components/settings/hours-section.tsx` inside `Section` |
| Product page | `src/components/public/service-profile.tsx` |
| Checkout sheet | `src/components/book/details-modal.tsx` |
| Customer order page | `src/components/documents/shared-document-page.tsx` |
| Invoice Pay button | the phone bottom bar in `service-profile.tsx` |

**Modes.** Owner screens are for getting work done: scannable, consistent, with nothing invented for flavour. The product page leads with the merchant's photos and has one action. Checkout and the order page are for getting work done too.

**Rules for every new screen**
- **Header:** the display headline Services and Bookings use, one muted line, and at most one primary button. No small labels above headings.
- **Lists** are rows or cards on `bg-surface rounded-card`, never tables.
- **Sheets:** a bottom sheet (`Modal`) only for create and edit forms, as Services does. Everything else happens in place.
- **Statuses** use `StatusPill` with plain product words: New, Ready for pickup, Out for delivery, Delivered, Collected, Cancelled, Oversold. Oversold uses the danger tone. Stock words come from `stockBadge`.
- **Loading** shows `Skeleton` rows, never a spinner in the content. **Errors** show `Notice tone="danger"` with `errorMessage(error)`.
- **Empty states** teach the next step:
  - Products: "Add your first product. Its link works like a booking link: put it in your bio or send it in a DM."
  - Orders: "Paid orders land here. Share a product link to get your first."
  - Customers: "Customers appear here as you book, invoice and sell."
- **Phone numbers** are `tel:` links. **Money** uses `formatMoney` ("NGN 45,000") with tabular figures.
- **Motion:** customer pages keep the existing `animate-rise`, `animate-rise-1` and `animate-rise-2` entrances. Owner screens get no entrance motion, only 150–250 ms state transitions.

**Owner screens**
- **Customers list:** a search field, then rows. Each row has the name and phone on the left and what they spent on the right. "Owes NGN 90,000" shows in danger text, only when it isn't zero.
- **Customer page:**
  - A "Customers" back link, the name as the headline, and the phone and email muted below.
  - Spent, Owes and Customer since in one row, using the Today page's `Stat` at its existing size.
  - New invoice (primary) and New receipt (secondary) buttons.
  - The timeline as rows; each one opens the customer's own page in a new tab.
  - "Edit details" opens the sheet. "Merge with another customer…" sits quietly at the sheet's foot and confirms with `ConfirmModal`: "Merge Tolu into Tolu Adeyemi? Their bookings, invoices, receipts and orders move to Tolu Adeyemi."
- **Products:**
  - Cards built like service cards, but with a **square** photo frame, so the owner sees what customers see.
  - Each option is a row with its `stockBadge`, followed by the copy-link field, the Live switch and Edit.
  - "Update stock" turns the option rows into number fields in place ("how many you have now"), with Save and Cancel. There is no separate stock sheet.
  - The editor sheet runs in this order:
    1. Photos: up to 5, with "Make cover" instead of drag-and-drop.
    2. Name, Price, Description.
    3. "Sizes, lengths or colours?": rows of name, price (placeholder "Same price") and stock, plus "Add an option".
    4. "Track stock": off means made to order, and hides the stock fields.
- **Orders:**
  - A `Segmented` filter: To send out (New and Ready, oldest first, the default), Done and Cancelled (newest first).
  - Each row is laid out like `booking-row.tsx`:
    - Left: order number and date.
    - Middle: status pill, customer name with a `tel:` phone, the items, and "Delivery to …" or "Pickup".
    - Right: the total, then the next step as a small dark button (Mark ready, then Mark delivered or Mark collected), Cancel as a ghost button, and a copy-link icon for the customer's order page.
  - Cancel confirms with `ConfirmModal`: "Cancel ORD-1022 and put the stock back?"
  - An oversold order shows the Oversold pill and the line "Paid after it sold out. Restock or refund."
  - An order that came from an invoice shows "From INV-1042" and a "Change to delivery" text button that opens an address field in place.
- **Selling settings** (`id="selling"`):
  - "What you sell" as a `Segmented` control.
  - An "Offer delivery" `Switch`. When it's on, a fee field appears with the hint "One fee for every delivery. Use 0 for free delivery."
  - An "Offer pickup" `Switch`, with the business address shown read-only beside an "Edit in Profile" link.
  - One Save button, like the other sections.
- **Onboarding:** "What do you sell?" as a `Segmented` control under the business name, with the hint "You can change this later in Settings."
- **Today:**
  - Section numbers keep matching the chat menu for this business, from `MENU[sells]`:
    - SERVICES: unchanged.
    - PRODUCTS: 5 is "Orders to send out".
    - BOTH: 5 is Today's bookings and 7 is Orders to send out.
  - Action 3 is "Share a link". For PRODUCTS it goes to `/products`. For BOTH it opens a sheet listing every service and product with its `CopyLinkButton`, the way the chat lists them.
  - "Running low" is a `Panel` with no number, because it isn't a chat action, so `Panel`'s `n` becomes optional. It only shows when something is low.
- **Item picker in the invoice and receipt forms:** products come after services under their own "Products" heading, labelled like `Frontal wig — 20" · NGN 45,000 · 11 in stock`. A sold-out option can still go on an invoice (a pre-order) but warns on a receipt.

**Customer pages**
- **Product page:** `ServiceProfile`'s structure on `PublicPage` (`width="wide"`, credit "Orders", so the footer reads "Orders by sara").
  - **On a phone,** top to bottom:
    1. A square photo frame the customer swipes through (CSS scroll-snap, `rounded-shot`). Position dots appear only with more than one photo, as buttons labelled like "Photo 2 of 3".
    2. The name as the service page's h1, then the price.
    3. Option chips styled like DESIGN.md's Booking Slots:
       - available: white with a hairline border
       - selected: mint wash with a deep teal outline
       - sold out: leaf grey with faint struck-through text, disabled
       - the first available option is preselected.
    4. "Only 3 left" in `text-ink-2 font-semibold`, never danger red.
    5. A quantity stepper copied from `src/components/book/day-count-stepper.tsx`.
    6. The description, then the delivery and pickup terms ("Delivery: NGN 3,000", "Pickup: Admiralty Way, Lekki").
    7. "More from <business>": up to six other products.

    The one action, "Buy now · NGN 90,000", rides the fixed bottom bar.
  - **On desktop,** the square photo column sits on the right and stays in view as you scroll (`lg:grid-cols-[1fr_460px]`). The button sits under the price.
  - **When nothing can be bought:** if every option is sold out, the button is disabled and reads "Sold out". If `canBuy` is false, a `Notice` replaces the button: "Not available to buy online yet. Message <business> to order."
- **Checkout sheet:** built like `DetailsModal`, titled "Your details". In order:
  1. The line: `2 × Frontal wig — 20"` · NGN 90,000.
  2. Delivery or Pickup as a `Segmented` control, or one fixed line when only one is offered.
  3. The delivery address (a two-row `Textarea`) or the pickup address.
  4. Name, Phone (required, `type="tel"`), and Email (optional, "for your receipt").
  5. Items, Delivery fee and Total.
  6. "Pay NGN 93,000 with Paystack", with the existing note "Payment is handled by Paystack. You come back here afterwards."

  If the checkout returns 409 ("Only 4 left"), say so above the button and lower the quantity cap. If the product is no longer available, close the sheet and show a `Notice`.
- **Customer order page:** built like `SharedDocumentPage` on `PublicPage` (narrow, credit "Orders").
  - The status pill, the headline "Order ORD-1022" ("Your order" before it's paid), and "From Tobi Hair · Paid 21 Oct 2026".
  - The document sheet with the lines, delivery fee and total. Then "Pickup from …" or "Delivery to …", and "View receipt".
  - While the order is awaiting payment, `AwaitConfirmation` takes the sheet's place.
- **Invoice Pay button:** on phones, it uses the fixed bottom bar from `ServiceProfile`: "Pay NGN 30,000 with Paystack". From `lg`, it's a large button under the document. It only shows when `payable` isn't null.

---

## Phase 1: Customers and general document lines

### Task 1: Generalise invoice and receipt lines

**Files:**
- Modify: `prisma/schema.prisma`. Replace `InvoiceService`/`ReceiptService` with `InvoiceLine`/`ReceiptLine`, set `Invoice.lines` and `Receipt.lines`, and set `Service.invoiceLines` and `Service.receiptLines`.
- Create: `prisma/migrations/<timestamp>_generalise_document_lines/migration.sql`
- Create: `src/backend/services/lines/index.ts` and `src/backend/services/lines/index.test.ts`
- Modify every reader and writer of `.services` on invoices and receipts (the list comes from a grep at plan time):
  - `src/backend/selects.ts:27,42`
  - `src/backend/services/invoice/index.ts`
  - `src/backend/services/receipt/index.ts`
  - `src/backend/services/messaging/dispatch/index.ts:18-23,59,79`
  - `src/backend/services/messaging/engine/index.ts:420`
  - `src/app/api/invoices/route.ts:68`, `src/app/api/invoices/[slug]/route.ts:98-116,155,272`
  - `src/app/api/receipts/route.ts:64`, `src/app/api/receipts/[slug]/route.ts:38,98-114,145`
  - `src/backend/validators/invoice.validator.ts`, `receipt.validator.ts`, `document-form.validator.ts`
  - `src/utils/document-preview.ts:72,94`, `src/utils/documents.ts:80-84`, `src/server/documents.ts:70,125`
  - `src/components/invoices/invoice-row.tsx:45`, `src/components/receipts/receipt-row.tsx:23`
  - `src/hooks/use-document-composer.ts`, `src/utils/api.ts`
  - every test fixture that uses `services:`.

**Interfaces:**
- Produces:
  - Prisma `InvoiceLine` and `ReceiptLine`, each with `{ id, invoiceId|receiptId, serviceId: string|null, name: string, description: string|null, quantity: Int, unitPrice: Decimal(10,2), total: Decimal(10,2), position: Int }`. The `service` relation uses `onDelete: SetNull`, so a line keeps its name when its service is deleted.
  - `type DocumentLineInput = { serviceId?: string | null; name?: string; description?: string | null; quantity: number; unitPrice: number; total: number }`
  - `type ResolvedLine = { serviceId: string | null; name: string; description: string | null; quantity: number; unitPrice: number; total: number; position: number }`
  - `resolveDocumentLines(client: Prisma.TransactionClient, businessId: string, lines: DocumentLineInput[]): Promise<ResolvedLine[]>`
  - The API request and response field is renamed from `services` to `lines` everywhere. In `src/utils/api.ts`, `LineItemInput` is renamed `DocumentLineInput`, with the same shape as above.

- [ ] **Step 1: Write the failing resolver tests** in `src/backend/services/lines/index.test.ts`

```ts
it("fills the name from the service and numbers the lines", async () => {
  // tx.service.findMany → [{ id: "svc_1", name: "Knotless braids" }]
  const lines = await resolveDocumentLines(tx, "biz_1", [
    { serviceId: "svc_1", quantity: 2, unitPrice: 25000, total: 50000 },
  ]);
  expect(lines).toEqual([{ serviceId: "svc_1", name: "Knotless braids", description: null,
    quantity: 2, unitPrice: 25000, total: 50000, position: 0 }]);
  expect(tx.service.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: { in: ["svc_1"] }, businessId: "biz_1" } }));
});
it("rejects a service from another business", async () => {
  // findMany → []
  await expect(resolveDocumentLines(tx, "biz_1", [{ serviceId: "svc_x", quantity: 1, unitPrice: 1, total: 1 }]))
    .rejects.toBeInstanceOf(BadRequestException);
});
it("keeps a named line that has no service", async () => {
  const [line] = await resolveDocumentLines(tx, "biz_1", [{ name: "Delivery", quantity: 1, unitPrice: 3000, total: 3000 }]);
  expect(line).toMatchObject({ serviceId: null, name: "Delivery" });
});
it("rejects a line with neither a service nor a name", async () => {
  await expect(resolveDocumentLines(tx, "biz_1", [{ quantity: 1, unitPrice: 1, total: 1 }]))
    .rejects.toBeInstanceOf(BadRequestException);
});
```

- [ ] **Step 2: Run** `yarn test src/backend/services/lines`. Expected: FAIL, "Cannot find module './index'".

- [ ] **Step 3: Implement `resolveDocumentLines`** in `src/backend/services/lines/index.ts`. Keep the error message the invoice service uses today for unknown services.

- [ ] **Step 4: Run** `yarn test src/backend/services/lines`. Expected: PASS.

- [ ] **Step 5: Change the schema and write the migration.**
  - Run `yarn prisma migrate dev --create-only --name generalise_document_lines`.
  - Edit the generated SQL so it creates both tables, copies the old rows, then drops the old tables:

```sql
INSERT INTO "InvoiceLine" ("id","invoiceId","serviceId","name","description","quantity","unitPrice","total","position")
SELECT gen_random_uuid()::text, s."invoiceId", s."serviceId", sv."name", s."description", s."quantity", s."unitPrice", s."total", 0
FROM "InvoiceService" s JOIN "Service" sv ON sv."id" = s."serviceId";
-- same for "ReceiptLine" from "ReceiptService" (s."receiptId")
DROP TABLE "InvoiceService";
DROP TABLE "ReceiptService";
```

  - Note `SELECT count(*) FROM "InvoiceService"` and the same for `"ReceiptService"`, then run `yarn prisma migrate dev`.

- [ ] **Step 6: Point every listed reader and writer at `lines`.**
  - `invoiceService.create` and `receiptService.create` take `lines?: DocumentLineInput[]`, call `resolveDocumentLines` inside their transaction, and write `lines: { create: resolved }`.
  - Readers use `line.name` instead of `line.service.name`.
  - `receiptService.create` copies `payment.invoice.lines` where it used to copy `payment.invoice.services`.
  - The chat `WriteDraft.services` becomes `WriteDraft.lines` (`WriteServiceDraft` is renamed `WriteLineDraft`, with the same fields).
  - Update the test fixtures.

- [ ] **Step 7: Verify.**
  - `yarn typecheck`: no errors.
  - `yarn test`: all PASS.
  - The `"InvoiceLine"` and `"ReceiptLine"` counts equal the counts noted in Step 5.
  - In `yarn dev`, an existing invoice's customer page (`/invoices/<publicId>`) shows the same lines and total as before.

- [ ] **Step 8: Commit**

```bash
git add prisma src
git commit -m "feat(documents): store invoice and receipt lines in general line tables"
```

### Task 2: Customer model and matching

**Files:**
- Modify: `prisma/schema.prisma`
  - add the `Customer` model
  - add `customerId String?` (with `onDelete: SetNull` and `@@index([customerId])`) to `Booking`, `Invoice`, `Receipt` and `Payment`
  - add `Business.customers`.
- Create: `prisma/migrations/<timestamp>_add_customers/migration.sql`, generated.
- Create: `src/backend/services/customer/normalize.ts`, `normalize.test.ts`, `index.ts`, `index.test.ts`

**Interfaces:**
- Produces:
  - Prisma `Customer`: `{ id, businessId, name, nameKey, phone: string|null, email: string|null, address: string|null, notes: string|null, createdAt, updatedAt }`, with `@@unique([businessId, phone])`, `@@unique([businessId, email])` and `@@index([businessId, nameKey])`.
  - `normalizePhone(raw?: string | null): string | null`
  - `normalizeEmail(raw?: string | null): string | null`
  - `nameKey(raw: string): string`
  - `type CustomerInput = { businessId: string; name?: string | null; phone?: string | null; email?: string | null; address?: string | null }`
  - `customerService.resolve(client: Prisma.TransactionClient, input: CustomerInput): Promise<Customer | null>`
  - `customerService.ownedBy(client: Prisma.TransactionClient, businessId: string, customerId: string): Promise<Customer>`. It throws `BadRequestException("Customer not found for this business")`.

- [ ] **Step 1: Write the failing normaliser tests.** Review Focus #3.

```ts
it.each(["0803 555 0142", "+234 803 555 0142", "2348035550142", "08035550142", "8035550142", "+234-803-555-0142"])(
  "normalises %s to +2348035550142", (raw) => expect(normalizePhone(raw)).toBe("+2348035550142"));
it("keeps a foreign number written with + or 00", () => {
  expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
  expect(normalizePhone("0044 7700 900123")).toBe("+447700900123");
});
it.each(["", "12", "abc", null, undefined])("returns null for %s", (raw) => expect(normalizePhone(raw)).toBeNull());
it("lower-cases and trims email", () => expect(normalizeEmail(" Tolu@Example.COM ")).toBe("tolu@example.com"));
it("rejects a malformed email", () => expect(normalizeEmail("tolu@")).toBeNull());
it("keys names without case or extra spaces", () => expect(nameKey("  Tolu   Adeyemi ")).toBe("tolu adeyemi"));
```

- [ ] **Step 2: Run** `yarn test src/backend/services/customer/normalize`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `normalize.ts`.** Strip everything but digits, remembering whether the raw value started with `+`. Then apply these rules in order:
  1. A leading `00` means international: treat it as `+`.
  2. A `+` number keeps its 8–15 digits.
  3. 13 digits starting `234` gets a `+` in front.
  4. 11 digits starting `0` becomes `+234` plus the last 10 digits.
  5. 10 digits not starting `0` becomes `+234` plus the digits.
  6. Anything else is `null`.

- [ ] **Step 4: Run** the normaliser tests. Expected: PASS.

- [ ] **Step 5: Write the failing `resolve` tests** in `index.test.ts`, with a mocked `tx.customer`.

```ts
it("matches by phone written another way", ...)            // findUnique phone "+2348035550142" → existing; expect(result.id).toBe("cus_1"); create not called
it("fills a missing email on a phone match", ...)          // update called with { email: "tolu@example.com" }
it("matches by email when there is no phone", ...)
it("matches a name-only record to the one customer with that name", ...) // findMany({ where: { businessId, nameKey: "tolu adeyemi" }, take: 2 }) → [one]
it("creates a new customer when two customers share the name", ...)      // findMany → [two] → create called
it("fills the phone into the one name-only customer with that name", ...) // phone given, no phone/email match, findMany({..., phone: null, email: null}) → [one] → update { phone }
it("creates a new customer when the name matches but the phone on file differs", ...)
it("returns null with no name, phone or email", ...)       // expect(await resolve(tx, { businessId: "biz_1" })).toBeNull()
```

- [ ] **Step 6: Run** `yarn test src/backend/services/customer`. Expected: FAIL.

- [ ] **Step 7: Implement `customerService.resolve` and `ownedBy`.** Follow the spec's matching rules: phone, then email, then exact `nameKey`, which only applies when the record has neither phone nor email, or when the one customer with that name has neither on file. A new customer's `name` is the trimmed name, or else the phone, or else the email. On a Prisma `P2002` from a concurrent create, look the customer up again once.

- [ ] **Step 8: Migrate and run.** Run `yarn prisma migrate dev --name add_customers`, then `yarn test src/backend/services/customer` (expected PASS) and `yarn typecheck` (clean).

- [ ] **Step 9: Commit**

```bash
git add prisma src/backend/services/customer
git commit -m "feat(customers): add customers matched by phone, email or name"
```

### Task 3: Link records to customers, and backfill

**Files:**
- Modify: `src/backend/services/booking/index.ts` (`createWithPayment`), `src/backend/services/invoice/index.ts`, `src/backend/services/receipt/index.ts`, and the booking branch of `src/app/api/webhooks/paystack/route.ts`
- Modify: `src/backend/validators/invoice.validator.ts` and `receipt.validator.ts` to add an optional `customerId`
- Create: `src/backend/services/customer/backfill.ts`, `backfill.test.ts`, `src/app/api/cron/backfill-customers/route.ts`, `route.test.ts`

**Interfaces:**
- Consumes: `customerService.resolve` and `customerService.ownedBy` from Task 2.
- Produces:
  - `CreateInvoiceInput` and `CreateReceiptInput` gain `customerId?: string | null`.
  - `customerBackfill.run(opts?: { batchSize?: number }): Promise<{ bookings: number; invoices: number; receipts: number; payments: number }>`
  - `GET /api/cron/backfill-customers` is guarded by `Authorization: Bearer <CRON_SECRET>`, like `src/app/api/cron/booking-reminders/route.ts`.

- [ ] **Step 1: Write the failing tests.**

```ts
// invoice/index.test.ts
it("links the invoice to the resolved customer", ...)  // resolve mocked → { id: "cus_1" }; create data.customerId === "cus_1"
it("uses an explicit customerId owned by the business", ...)
it("rejects a customerId from another business", ...)  // ownedBy throws → rejects BadRequestException
// receipt/index.test.ts: the same three
// booking/index.test.ts
it("creates the booking with the resolved customerId", ...)
// customer/backfill.test.ts
it("links unlinked bookings, invoices and receipts, and leaves linked ones alone", ...)
it("gives a payment the customer of its booking or invoice", ...)
it("is safe to run twice", ...)                        // second run returns all zeros
// cron route.test.ts
it("returns 401 without the cron secret", ...)
```

- [ ] **Step 2: Run** `yarn test src/backend/services src/app/api/cron`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement the links.**
  - Bookings resolve their customer before the serializable insert, so a retry doesn't create two customers.
  - Invoices and receipts resolve inside their own transaction, or use `ownedBy` when they're given a `customerId`.
  - The webhook's booking Payment copies `booking.customerId`.

- [ ] **Step 4: Implement `customerBackfill.run`.** Page through records with `customerId: null` (default batch 200) and call `resolve` with each record's snapshot fields. A payment takes the customer of its booking or invoice before falling back to its own snapshot.

- [ ] **Step 5: Run** `yarn test`. Expected: PASS. Then run `yarn typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat(customers): link bookings, invoices, receipts and payments to customers"
```

### Task 4: Customers API

**Files:**
- Modify: `src/backend/services/customer/index.ts` and `index.test.ts`, and `types/index.ts`
- Create: `src/backend/validators/customer.validator.ts`, `src/app/api/customers/route.ts`, `src/app/api/customers/[id]/route.ts`, `src/app/api/customers/merge/route.ts`, and a `route.test.ts` for each

**Interfaces:**
- Consumes: `UNPAID_STATUSES` from `src/backend/services/dashboard/index.ts` and `publicPath` from `src/utils/public-links.ts`.
- Produces (types in `types/index.ts`):
  - `CustomerListItem = { id: string; name: string; phone: string | null; email: string | null; spent: number; owes: number; lastActivityAt: string | null }`
  - `TimelineEntry = { kind: "booking" | "invoice" | "receipt" | "order"; id: string; label: string; amount: number; status: string; at: string; href: string | null }`
  - `CustomerDetail = CustomerListItem & { address: string | null; notes: string | null; createdAt: string; timeline: TimelineEntry[] }`
- Produces (service methods):
  - `customerService.list(businessId, { query?: string; page: number; size: number }): Promise<{ data: CustomerListItem[]; total: number }>`
  - `customerService.detail(businessId, id): Promise<CustomerDetail>`
  - `customerService.update(businessId, id, patch: { name?; phone?; email?; address?; notes? }): Promise<Customer>`
  - `customerService.merge(businessId, keepId, mergeId): Promise<Customer>`
- Produces (routes):
  - `GET /api/customers?query=&page=&size=`
  - `GET /api/customers/[id]`
  - `PUT /api/customers/[id]`
  - `POST /api/customers/merge { keepId, mergeId }`

- [ ] **Step 1: Write the failing tests.**

```ts
it("counts spent as payments plus receipts without a payment", ...) // payment.aggregate 15000 + receipt (paymentId null) 5000 → spent 20000
it("counts owes from unpaid invoices only", ...)                    // SENT 50000/paid 10000 + VOID ignored → owes 40000
it("searches name, phone and email", ...)                           // where.OR has name contains, email contains, phone contains digits
it("lists the timeline newest first with customer links", ...)      // invoice entry href "/invoices/<publicId>"
it("refuses a phone another customer already has", ...)              // update P2002 → ConflictException("Another customer already has this phone number")
it("moves every record to the kept customer, then deletes the other", ...) // updateMany on booking, invoice, receipt, payment → { customerId: "keep" }; delete({ where: { id: "merge" } })
it("fills the kept customer's missing phone from the merged one", ...)
it("refuses to merge a customer with itself", ...)                  // BadRequestException
it("returns 404 for a customer of another business", ...)
// routes
it("GET /api/customers needs a session", ...) // 401
```

- [ ] **Step 2: Run** `yarn test src/backend/services/customer src/app/api/customers`. Expected: FAIL.

- [ ] **Step 3: Implement the service methods** with these definitions:
  - **spent** is the sum of `Payment.amount` for the customer, plus the sum of `Receipt.amountPaid` for their receipts with `paymentId: null`.
  - **owes** is the sum of `total − amountPaid` over invoices whose status is in `UNPAID_STATUSES`.
  - **lastActivityAt** is the newest `createdAt` across the customer's records.
  - Timeline labels: `Booking · <service name>`, `Invoice INV-1042`, `Receipt RCP-2210`. Task 15 adds `Order ORD-1022`.
  - The merge runs in one transaction.

- [ ] **Step 4: Implement the three routes.** Model them on `src/app/api/services/route.ts` (ownership check, envelope, exceptions). The query schema extends `baseQueryValidatorSchema`.

- [ ] **Step 5: Run** `yarn test` (expected PASS), then `yarn typecheck`.

- [ ] **Step 6: Commit** with `git commit -m "feat(customers): list, view, edit and merge customers"`

### Task 5: Customers screens

**Files:**
- Create:
  - `src/app/(app)/customers/page.tsx` and `src/app/(app)/customers/[id]/page.tsx`
  - `src/components/customers/customers-page-client.tsx`, `customer-row.tsx`, `customer-row.test.tsx`, `customer-detail-client.tsx`, `customer-edit-modal.tsx` (merging lives at the foot of this sheet)
  - `src/hooks/queries/use-customers.ts` and `src/hooks/mutations/use-customer-mutations.ts`
- Modify:
  - `src/utils/api.ts`: add `api.customers.{list,get,update,merge}`
  - `src/components/app-chrome.tsx`: add the `/customers` "Customers" nav item, shown to every business
  - `src/middleware.ts`: add the matchers `"/customers"` and `"/customers/:path*"`. Unlike `/products/<slug>`, a customer page is owner-only.
  - `src/utils/cards.ts`: add a `customers` card and a `DESTINATION_CARDS` entry
  - `src/hooks/use-document-composer.ts` and `src/components/documents/document-modal.tsx`: the customer field searches `api.customers.list({ query })`, fills name, phone and email, and sends `customerId`
  - `src/components/invoices/invoices-page-client.tsx` and `receipts-page-client.tsx`: open the composer prefilled when the URL has `?compose=1&customer=<id>`

**Interfaces:**
- Consumes: the Task 4 endpoints and types.
- Produces:
  - `customerKeys`
  - `useCustomersQuery(params: { query?: string; page?: number })`
  - `useCustomerQuery(id: string)`
  - `useUpdateCustomerMutation()` and `useMergeCustomersMutation()`

- [ ] **Step 1: Write the failing row test** (`customer-row.test.tsx`, styled like `invoice-row.test.tsx`)

```ts
it("shows what the customer spent and owes", () => {
  // render <CustomerRow customer={{ name: "Tolu Adeyemi", phone: "+2348035550142", spent: 310000, owes: 90000, ... }} currency="NGN" />
  expect(html).toContain("Tolu Adeyemi");
  expect(html).toContain("NGN 310,000");
  expect(html).toContain("Owes NGN 90,000");
});
it("leaves out the owes line when nothing is owed", ...)
```

- [ ] **Step 2: Run** `yarn test src/components/customers`. Expected: FAIL.

- [ ] **Step 3: Invoke the impeccable skill, then build both screens to the UI direction's "Customers list" and "Customer page".**
  - New invoice and New receipt link to `/invoices?compose=1&customer=<id>` and `/receipts?compose=1&customer=<id>`.
  - Use the primitives from `@/primitives`. The empty state is the UI direction's Customers line.

- [ ] **Step 4: Verify.**
  - `yarn test` and `yarn typecheck` pass.
  - Run `.agents/skills/impeccable/scripts/impeccable detect --json src/components/customers src/app/\(app\)/customers` once and fix what it reports.
  - In `yarn dev` at 375px and 1440px: search finds a customer by phone, the customer page shows the timeline, a merge from the edit sheet leaves one customer, and the composer's customer search fills the fields.

- [ ] **Step 5: Commit** with `git commit -m "feat(customers): customer list, customer page and composer search"`

## Phase 2: Products

### Task 6: Product model and product service

**Files:**
- Modify: `prisma/schema.prisma`
  - add `enum BusinessSells { SERVICES PRODUCTS BOTH }`
  - on `Business`, add `sells BusinessSells @default(SERVICES)`, `offersDelivery Boolean @default(false)`, `deliveryFee Decimal? @db.Decimal(10,2)`, `offersPickup Boolean @default(false)` and a `products` relation
  - add the `Product` and `ProductOption` models
  - add `productOptionId String?` (relation with `onDelete: SetNull`) to `InvoiceLine` and `ReceiptLine`.
- Create: `prisma/migrations/<timestamp>_add_products/migration.sql`, generated.
- Create: `src/backend/services/product/index.ts`, `index.test.ts`, `labels.ts`, `labels.test.ts`

**Interfaces:**
- Produces (models):
  - `Product { id, slug @unique, businessId, name, description?, price Decimal(10,2), photos String[], tracksStock Boolean @default(true), isActive Boolean @default(true), createdAt, updatedAt, options ProductOption[] }`
  - `ProductOption { id, productId, name String @default(""), price Decimal(10,2)?, stock Int @default(0), position Int @default(0), isActive Boolean @default(true) }`
- Produces (types):
  - `type ProductOptionInput = { id?: string; name: string; price?: number | null; stock: number }`
  - `type ProductInput = { name: string; description?: string | null; price: number; tracksStock: boolean; options: ProductOptionInput[] }`
  - `type ProductWithOptions = Product & { options: ProductOption[] }`. Its options are active only, ordered by `position`.
- Produces (service methods):
  - `productService.create(businessId: string, input: ProductInput, photos: string[]): Promise<ProductWithOptions>`
  - `productService.update(businessId: string, slug: string, patch: Partial<ProductInput> & { isActive?: boolean; photos?: string[] }): Promise<ProductWithOptions>`
  - `productService.list(businessId: string, opts?: { includeInactive?: boolean }): Promise<ProductWithOptions[]>`
  - `productService.getBySlug(businessId: string, slug: string): Promise<ProductWithOptions>`
  - `productService.adjustStock(businessId: string, optionId: string, change: { add: number } | { set: number }): Promise<ProductOption>`
- Produces (labels): `optionLabel(productName: string, optionName: string): string`

- [ ] **Step 1: Write the failing tests.**

```ts
// labels.test.ts
expect(optionLabel("Frontal wig", '20"')).toBe('Frontal wig — 20"');
expect(optionLabel("Shea butter 250ml", "")).toBe("Shea butter 250ml");
// index.test.ts
it("creates a product with its options in order and a slug from the name", ...) // slug "frontal-wig"; options positions 0,1,2
it("adds a suffix when the slug is taken", ...)
it("refuses more than 5 photos", ...)               // BadRequestException("A product can have up to 5 photos")
it("refuses two options with the same name", ...)   // BadRequestException("Each option needs a different name")
it("refuses an unnamed option next to named ones", ...)
it("deactivates options missing from an update instead of deleting them", ...) // option.update({ isActive: false })
it("adds stock and sets stock", ...)                 // { add: 5 } on 6 → 11; { set: 2 } → 2
it("refuses stock below zero", ...)                  // { add: -7 } on 6 → BadRequestException("Stock can't go below zero")
it("refuses a stock change on a product that doesn't track stock", ...)
it("returns 404 for a product of another business", ...)
```

- [ ] **Step 2: Run** `yarn test src/backend/services/product`. Expected: FAIL.

- [ ] **Step 3: Implement** to these rules:
  - 1–20 options per product.
  - At most 5 photos.
  - The product name is 1–255 characters.
  - Prices are 0 or more.
  - Option names are unique, ignoring case.
  - An empty option name is allowed only when it's the product's only option.
  - The slug is `slugify(name, { lower: true, strict: true })`, with the same uniqueness loop as `src/app/api/services/route.ts`.

- [ ] **Step 4: Migrate** with `yarn prisma migrate dev --name add_products`. Run `yarn test src/backend/services/product` (expected PASS) and `yarn typecheck`.

- [ ] **Step 5: Commit** with `git commit -m "feat(products): add products with options and stock"`

### Task 7: Products API

**Files:**
- Create: `src/backend/validators/product.validator.ts` and `product.validator.test.ts`
- Create: `src/app/api/products/route.ts`, `src/app/api/products/[slug]/route.ts`, `src/app/api/products/[slug]/stock/route.ts`, and a `route.test.ts` for each
- Modify: `types/index.ts` to add `ProductOptionDto = Serialized<ProductOption>` and `ProductDto = Serialized<Product> & { options: ProductOptionDto[] }`

**Interfaces:**
- Consumes: `productService` from Task 6, and `cloudinaryService.uploadFile(file, { folder: \`sara/${business.id}/products\` })`.
- Produces:
  - `POST /api/products` (multipart). Fields: `name`, `description`, `price`, `tracksStock` ("true" or "false"), `options` (a JSON string of `ProductOptionInput[]`) and `photos` (a File, repeatable).
  - `GET /api/products` returns `ProductDto[]`.
  - `GET /api/products/[slug]` returns `ProductDto`.
  - `PUT /api/products/[slug]` (multipart). It takes any of the create fields, plus `keepPhotos` (a JSON string of existing URLs, in the order to keep them), new `photos` files (added after the kept ones) and `isActive`.
  - `POST /api/products/[slug]/stock` takes `{ optionId: string; add?: number; set?: number }`, with exactly one of `add` or `set`.

- [ ] **Step 1: Write the failing tests.**

```ts
it("parses options from a JSON string", ...)            // productValidatorSchema.safeParse(form).data.options[0].name === '20"'
it("rejects options that aren't valid JSON", ...)
it("needs exactly one of add or set", ...)              // stockAdjustValidatorSchema
it("POST uploads each photo and creates the product", ...) // uploadFile called twice; productService.create(…, ["https://cdn/1", "https://cdn/2"])
it("PUT keeps photos in the given order and adds the new ones after them", ...)
it("POST /stock returns the updated option", ...)
it("needs a session", ...)                              // 401
```

- [ ] **Step 2: Run** `yarn test src/backend/validators/product src/app/api/products`. Expected: FAIL.

- [ ] **Step 3: Implement the validators and routes.** Model them on `src/app/api/services/route.ts` and `[slug]/route.ts`: multipart parsing, ownership check, envelope. Upload the photos before calling the service, so the service only ever sees URLs.

- [ ] **Step 4: Run** `yarn test` (expected PASS) and `yarn typecheck`.

- [ ] **Step 5: Commit** with `git commit -m "feat(products): product API with photos and stock changes"`

### Task 8: Product lines on invoices and receipts

**Files:**
- Modify: `src/backend/services/lines/index.ts` and `index.test.ts`, `src/backend/validators/invoice.validator.ts` and `receipt.validator.ts`, `src/utils/api.ts` (`DocumentLineInput`)

**Interfaces:**
- Consumes: `optionLabel` from Task 6.
- Produces: `DocumentLineInput` and `ResolvedLine` gain `productOptionId?: string | null`, and `ResolvedLine.productOptionId: string | null`.

- [ ] **Step 1: Write the failing tests.**

```ts
it("names a product line after its product and option", ...) // option { name: '20"', product: { name: "Frontal wig", businessId: "biz_1" } } → name 'Frontal wig — 20"'
it("rejects an option from another business", ...)
it("rejects an inactive option", ...)                         // BadRequestException("This product is no longer available")
it("rejects a line with both a service and a product option", ...)
```

- [ ] **Step 2: Run** `yarn test src/backend/services/lines`. Expected: FAIL.

- [ ] **Step 3: Implement.** Load the options with `tx.productOption.findMany({ where: { id: { in }, isActive: true, product: { businessId, isActive: true } }, include: { product: { select: { name: true } } } })`.

- [ ] **Step 4: Run** `yarn test` (expected PASS) and `yarn typecheck`.

- [ ] **Step 5: Commit** with `git commit -m "feat(documents): invoice and receipt lines can be product options"`

### Task 9: Products screen

**Files:**
- Create:
  - `src/app/(app)/products/page.tsx`
  - `src/components/products/products-page-client.tsx`, `product-card.tsx` (which edits stock in place), `product-modal.tsx`, `options-editor.tsx`
  - `src/backend/validators/product-form.validator.ts` and `product-form.validator.test.ts`
  - `src/utils/stock.ts` and `stock.test.ts`
  - `src/hooks/queries/use-products.ts` and `src/hooks/mutations/use-product-mutations.ts`
- Modify:
  - `src/utils/api.ts`: add `api.products.{list, create(values, photos), update(slug, values, photos, keepPhotos), adjustStock(slug, input)}`
  - `src/utils/public-links.ts`: add `productPath(slug)`, which returns `/products/<slug>`
  - `src/server/share.ts`: add `productLink(slug)`
  - `src/components/app-chrome.tsx` and `src/app/(app)/layout.tsx`: the nav reads `business.sells`
  - `src/middleware.ts`: add the `"/products"` and `"/orders"` matchers (owner lists only)
  - `src/utils/cards.ts`: add `products` and `orders` cards

**Interfaces:**
- Consumes: the Task 7 endpoints and `ProductDto`.
- Produces:
  - `LOW_STOCK = 3`
  - `stockBadge(tracksStock: boolean, stock: number): { label: string; tone: "ok" | "low" | "out" | "untracked" }`
  - `productFormSchema`, which parses strings to numbers like `serviceFormSchema`
  - `productKeys` and `useProductsQuery(initial?)`
  - `AppChrome` takes a `sells: "SERVICES" | "PRODUCTS" | "BOTH"` prop.
    - Bookings and Services show for SERVICES or BOTH.
    - Orders and Products show for PRODUCTS or BOTH.
    - Today, Invoices, Receipts, Customers and Settings always show.

- [ ] **Step 1: Write the failing tests.**

```ts
expect(stockBadge(true, 11)).toEqual({ label: "11 in stock", tone: "ok" });
expect(stockBadge(true, 3)).toEqual({ label: "3 left", tone: "low" });
expect(stockBadge(true, 0)).toEqual({ label: "Sold out", tone: "out" });
expect(stockBadge(false, 0)).toEqual({ label: "Made to order", tone: "untracked" });
// product-form.validator.test.ts
it("turns '45,000' into 45000", ...)
it("needs a stock number for each option when stock is tracked", ...) // message "Enter how many you have"
```

- [ ] **Step 2: Run** `yarn test src/utils/stock src/backend/validators/product-form`. Expected: FAIL.

- [ ] **Step 3: Implement the helpers. Then invoke the impeccable skill and build the screen to the UI direction's "Products" entry.**
  - Product cards have a square photo frame, an option row with its `stockBadge`, the copy-link field (`productLink`), the Live switch (pause or resume) and Edit.
  - "Update stock" edits stock in place: number fields, then Save, which calls `api.products.adjustStock(slug, { optionId, set })` per changed option.
  - The editor sheet takes its sections in the direction's order. A product with no options is a single unnamed option row.
  - The empty state is the UI direction's Products line.

- [ ] **Step 4: Verify.**
  - `yarn test` and `yarn typecheck` pass.
  - Run `.agents/skills/impeccable/scripts/impeccable detect --json src/components/products` once and fix what it reports.
  - In `yarn dev` at 375px and 1440px: create a product with three options and two photos, make the second photo the cover, pause the product, update its stock in place, and copy its link.
  - A SERVICES-only business sees no Products or Orders in the nav.

- [ ] **Step 5: Commit** with `git commit -m "feat(products): products screen with options, photos and stock"`

### Task 10: What you sell, delivery and pickup settings

**Files:**
- Modify:
  - `src/backend/validators/business.validator.ts` and `src/app/api/business/route.ts` (POST and PUT)
  - `src/server/business.ts` (`toBusinessProfile`) and `types/index.ts` (`BusinessProfileDto`)
  - `src/components/onboarding/onboarding-client.tsx` and `src/components/settings/settings-page-client.tsx`
  - `src/utils/api.ts` (`BusinessUpdateInput`, `BusinessCreateInput`)
  - `src/components/products/products-page-client.tsx`
- Create: `src/components/settings/selling-section.tsx`, `src/utils/selling.ts`, `src/utils/selling.test.ts`

**Interfaces:**
- Produces:
  - `BusinessProfileDto` gains `sells`, `offersDelivery: boolean`, `deliveryFee: number | null` and `offersPickup: boolean`.
  - `canSellOnline(b: { isPaymentReady: boolean; offersDelivery: boolean; offersPickup: boolean }): boolean`

- [ ] **Step 1: Write the failing tests.**

```ts
expect(canSellOnline({ isPaymentReady: true, offersDelivery: false, offersPickup: true })).toBe(true);
expect(canSellOnline({ isPaymentReady: false, offersDelivery: true, offersPickup: true })).toBe(false);
expect(canSellOnline({ isPaymentReady: true, offersDelivery: false, offersPickup: false })).toBe(false);
it("needs a delivery fee when delivery is on", ...) // updateBusinessValidatorSchema → "Set a delivery fee, or 0 for free delivery"
it("PUT /api/business saves sells, delivery and pickup", ...)
it("refuses pickup without a business address", ...) // BadRequestException("Add your business address for pickup")
```

- [ ] **Step 2: Run** `yarn test src/utils/selling src/backend/validators src/app/api/business`. Expected: FAIL.

- [ ] **Step 3: Implement. Invoke the impeccable skill before the UI, and build it to the UI direction's "Selling settings" and "Onboarding" entries.**
  - Onboarding adds "What do you sell?" as a `Segmented` control (Services, Products, Both), defaulting to Services.
  - Settings gets the "Selling" section (`id="selling"`): what you sell, the "Offer delivery" switch with a fee field and its hint, and the "Offer pickup" switch showing the business address and an "Edit in Profile" link.
  - When `canSellOnline` is false, the products page shows a `Notice`: "Set delivery or pickup before customers can buy online", linking to `/settings#selling`. If payment isn't ready, it gives the same message the services page uses.

- [ ] **Step 4: Verify.**
  - `yarn test` and `yarn typecheck` pass.
  - Run `.agents/skills/impeccable/scripts/impeccable detect --json src/components/settings/selling-section.tsx src/components/onboarding/onboarding-client.tsx` once and fix what it reports.
  - In `yarn dev` at 375px: onboard as "Products", turn on pickup in Settings, and watch the products page notice clear.

- [ ] **Step 5: Commit** with `git commit -m "feat(business): what you sell, delivery fee and pickup settings"`

## Phase 3: Selling and orders

### Task 11: Order model and stock holds

**Files:**
- Modify: `prisma/schema.prisma`
  - add the enums `OrderStatus { AWAITING_PAYMENT NEW READY COMPLETED CANCELLED }`, `OrderSource { ONLINE RECEIPT INVOICE }` and `Fulfilment { DELIVERY PICKUP }`
  - add the `Order` and `OrderLine` models
  - add `Payment.orderId String?` with `onDelete: SetNull`, plus `Customer.orders`, `Business.orders` and `ProductOption.orderLines`.
- Create: `prisma/migrations/<timestamp>_add_orders/migration.sql`, generated.
- Create: `src/backend/services/product/stock.ts` and `stock.test.ts`

**Interfaces:**
- Produces (models):
  - `Order { id, slug @unique, publicId @unique @default(nanoid(16)), businessId, customerId?, orderNumber String?, status OrderStatus, source OrderSource, fulfilment Fulfilment, deliveryAddress?, deliveryFee Decimal @default(0), subtotal, total, currency, holdExpiresAt?, oversold Boolean @default(false), invoiceId String? @unique, receiptId String? @unique, clientName, clientPhone?, clientEmail?, notes?, paidAt?, readyAt?, completedAt?, cancelledAt?, createdAt, updatedAt, lines OrderLine[], payments Payment[] }`, with `@@unique([businessId, orderNumber])`. The number is assigned when the order is paid, so abandoned checkouts leave no gaps.
  - `OrderLine { id, orderId, productOptionId, name, quantity Int, unitPrice, total }`
- Produces (functions):
  - `type StockLine = { productOptionId: string; quantity: number }`
  - `activeHoldsWhere(now: Date): Prisma.OrderWhereInput`, which returns `{ status: "AWAITING_PAYMENT", holdExpiresAt: { gt: now } }`
  - `availableStock(client: Prisma.TransactionClient, optionIds: string[], now: Date): Promise<Map<string, number | null>>`. A null value means the option doesn't track stock.
  - `takeStock(client: Prisma.TransactionClient, lines: StockLine[]): Promise<{ short: boolean }>`
  - `returnStock(client: Prisma.TransactionClient, lines: StockLine[]): Promise<void>`

- [ ] **Step 1: Write the failing tests.**

```ts
it("subtracts quantities held by unexpired checkouts", ...) // stock 4, one held order line qty 1 → 3
it("ignores expired holds", ...)                          // holdExpiresAt in the past → 4
it("reports untracked options as null", ...)
it("takes stock down to zero and reports a shortfall", ...) // stock 1, take 2 → update stock 0, { short: true }
it("takes nothing from untracked options", ...)
it("puts stock back on tracked options only", ...)
```

- [ ] **Step 2: Run** `yarn test src/backend/services/product/stock`. Expected: FAIL.

- [ ] **Step 3: Implement `stock.ts`.**
  - Held quantities come from a `groupBy` over `OrderLine` where `order` matches `activeHoldsWhere(now)`.
  - `takeStock` reads each tracked option's stock and writes `max(stock − qty, 0)`. It must run inside the caller's transaction.

- [ ] **Step 4: Migrate** with `yarn prisma migrate dev --name add_orders`. Run `yarn test` (expected PASS) and `yarn typecheck`.

- [ ] **Step 5: Commit** with `git commit -m "feat(orders): add orders and stock holds"`

### Task 12: Order emails

**Files:**
- Create: `src/backend/services/email/templates/OrderEmail.tsx`
- Modify: `src/backend/services/email/messages.tsx`, `messages.test.tsx` and `index.ts`

**Interfaces:**
- Produces:
  - `type OrderEmailKind = "confirmed" | "ready" | "completed" | "cancelled"`
  - `orderEmail(input: { kind: OrderEmailKind; origin: string; to: string; business: BusinessSender; orderNumber: string; lines: { name: string; quantity: number; total: Money }[]; total: Money; currency: string; fulfilment: "DELIVERY" | "PICKUP"; deliveryAddress: string | null; pickupAddress: string | null; receiptUrl: string | null; orderUrl: string }): EmailMessage`
  - `emailService.sendOrderEmail(input: Input<typeof orderEmail>)`

- [ ] **Step 1: Write the failing tests**, with these exact subjects:

```ts
const subject = (kind, fulfilment) => orderEmail({ ...base, kind, fulfilment }).subject;
expect(subject("confirmed", "PICKUP")).toBe("Your order from Tobi Hair is confirmed");
expect(subject("ready", "PICKUP")).toBe("Your order from Tobi Hair is ready for pickup");
expect(subject("ready", "DELIVERY")).toBe("Your order from Tobi Hair is on its way");
expect(subject("completed", "DELIVERY")).toBe("Your order from Tobi Hair was delivered");
expect(subject("completed", "PICKUP")).toBe("Thanks for collecting your order from Tobi Hair");
expect(subject("cancelled", "PICKUP")).toBe("Your order from Tobi Hair was cancelled");
it("lists the order number, lines and total in the body", ...) // html contains "ORD-1022", '2 × Frontal wig — 20"', "NGN 93,000"
it("shows the pickup address on a ready pickup email", ...)
```

- [ ] **Step 2: Run** `yarn test src/backend/services/email`. Expected: FAIL.

- [ ] **Step 3: Implement one `OrderEmail` template.** Each kind changes its heading and lead line. Reuse `_components` and the booking emails' voice. Add `sendOrderEmail` next to `sendBookingConfirmationEmail`.

- [ ] **Step 4: Run** `yarn test src/backend/services/email` (expected PASS). Preview the emails with `yarn email:dev`.

- [ ] **Step 5: Commit** with `git commit -m "feat(email): order confirmed, ready, completed and cancelled emails"`

### Task 13: Checkout

**Files:**
- Create: `src/backend/services/order/index.ts`, `index.test.ts`, `src/app/api/public/orders/route.ts`, `route.test.ts`
- Modify: `types/index.ts` (`PublicOrderInput`, `PublicOrderDto`) and `src/utils/api.ts` (`api.public.order(input)`)

**Interfaces:**
- Consumes: `availableStock` and `activeHoldsWhere` from Task 11, `holdExpiresFrom` and `isSerializationFailure`, `customerService.resolve`, `paystackService.initializeTransaction`, and `optionLabel`.
- Produces:
  - `type CheckoutInput = { productSlug: string; optionId: string; quantity: number; fulfilment: "DELIVERY" | "PICKUP"; deliveryAddress?: string | null; clientName: string; clientPhone: string; clientEmail?: string | null }`
  - `orderService.startCheckout(input: CheckoutInput): Promise<{ order: Order; paymentUrl: string; paymentReference: string }>`
  - `nextOrderNumber(client: Prisma.TransactionClient, businessId: string): Promise<string>`, which follows `ORD-1001` and the invoice-number pattern in `src/backend/services/invoice/index.ts`
  - `POST /api/public/orders` takes a strict zod body matching `CheckoutInput` and returns `201 { data: { ...order, paymentUrl, paymentReference } }`.

- [ ] **Step 1: Write the failing tests.** Review Focus #4.

```ts
it("holds the stock for 30 minutes and charges quantity × price + delivery fee", ...)
//   option price null, product 45000, qty 2, deliveryFee 3000 → order total 93000, holdExpiresAt = now + 30 min,
//   initializeTransaction amount 9300000, subaccountCode "ACCT_1", metadata.orderId set, callbackUrl ends "?o=<slug>"
it("refuses more than is available", ...)               // available 4, qty 5 → ConflictException("Only 4 left")
it("refuses a paused product or removed option", ...)   // → BadRequestException("This product is no longer available")
it("refuses delivery without an address", ...)          // → BadRequestException("Enter a delivery address")
it("refuses a fulfilment the business doesn't offer", ...)
it("refuses when the business can't take payments", ...) // no paystackSubaccountCode → same message as bookings
it("retries once on a serialization failure", ...)      // first tx throws { code: "P2034" } → second succeeds
it("route: 422 on a body that fails validation", ...)
```

- [ ] **Step 2: Run** `yarn test src/backend/services/order src/app/api/public/orders`. Expected: FAIL.

- [ ] **Step 3: Implement `startCheckout`**, mirroring `bookingService.createWithPayment`:
  - Resolve the customer first.
  - Then, in a `Serializable` transaction: check availability and create the order as `AWAITING_PAYMENT` with `holdExpiresAt` and its line. Use the snapshot name from `optionLabel`, and `unitPrice = option.price ?? product.price`.
  - Retry once on `P2034`.
  - The slug is `${business.slug}-${Date.now().toString(36)}`, with the uniqueness loop.
  - Leave `orderNumber` null until payment.

- [ ] **Step 4: Run** `yarn test` (expected PASS) and `yarn typecheck`.

- [ ] **Step 5: Commit** with `git commit -m "feat(orders): product checkout with stock holds and Paystack"`

### Task 14: Taking payment for an order

**Files:**
- Create: `src/backend/services/order/payment.ts`, `payment.test.ts`, `src/backend/services/order/alerts.ts`, `alerts.test.ts`
- Modify: `src/backend/services/paystack/index.ts` (export `SuccessfulPaymentData`, moved from the webhook route), and `src/app/api/webhooks/paystack/route.ts`
  - dispatch on `metadata.orderId`
  - GET handles `?o=<orderSlug>` and payments linked to an order, redirecting to `publicPath("order", publicId)`
- Modify: `src/utils/public-links.ts`. `PublicKind` gains `"order"`, with segment `"orders"`.

**Interfaces:**
- Consumes: `takeStock`, `nextOrderNumber`, `receiptService.create` (with product `lines`, `paymentId` and `customerId`), `emailService.sendOrderEmail`, and `ownerNotifier.notify`.
- Produces:
  - `processOrderPayment(data: SuccessfulPaymentData): Promise<{ order: { publicId: string } } | null>`
  - `orderAlertText(order: { orderNumber: string; clientName: string; lines: { name: string; quantity: number }[]; total: number; currency: string; fulfilment: "DELIVERY" | "PICKUP"; deliveryAddress: string | null; oversold: boolean }): string`

- [ ] **Step 1: Write the failing tests.** Review Focus #1 and #2.

```ts
expect(orderAlertText({ orderNumber: "ORD-1022", clientName: "Tolu Adeyemi",
  lines: [{ name: 'Frontal wig — 20"', quantity: 2 }], total: 93000, currency: "NGN",
  fulfilment: "DELIVERY", deliveryAddress: "12 Admiralty Way", oversold: false }))
  .toBe('🛍️ New order ORD-1022 · Tolu Adeyemi · 2 × Frontal wig — 20" · NGN 93,000 · Delivery to 12 Admiralty Way');
it("ends a pickup alert with 'Pickup'", ...)
it("adds a second line to an oversold alert", ...) // "\n⚠️ Paid after it sold out. Restock or refund the customer."
it("marks the order NEW, numbers it, records the payment and takes the stock", ...) // status NEW, orderNumber "ORD-1001", payment { method: "PAYSTACK", orderId, customerId, reference }
it("sets oversold when a late payment finds the stock gone", ...) // takeStock → { short: true } → oversold true; stock never negative (takeStock floors)
it("does nothing the second time a reference arrives", ...)        // payment.findUnique(reference) → existing → returns { order }, no writes
it("records nothing when the amount doesn't match", ...)
it("creates the receipt with the product lines and a Delivery line", ...)
it("emails the customer only when there is an email", ...)
it("webhook dispatches orderId metadata to processOrderPayment", ...)
it("callback GET with ?o= redirects to /orders/<publicId>", ...)
```

- [ ] **Step 2: Run** `yarn test src/backend/services/order src/app/api/webhooks`. Expected: FAIL.

- [ ] **Step 3: Implement `processOrderPayment`.**
  - Skip if the reference already exists.
  - Check that the amount equals `Math.round(total * 100)` and the business matches.
  - In one transaction: take stock (setting `oversold` on a shortfall), set `status NEW`, `paidAt` and `orderNumber`, and create the Payment.
  - Then, best effort: create the receipt and set `order.receiptId`, alert the owner, and email the customer (`kind: "confirmed"`).
  - In the webhook route, `processSuccessfulPayment` calls it first when `metadata.orderId` is a string. The booking path is unchanged.

- [ ] **Step 4: Run** `yarn test` (expected PASS) and `yarn typecheck`.

- [ ] **Step 5: Commit** with `git commit -m "feat(orders): confirm paid orders, take stock and alert the owner"`

### Task 15: Owner order management

**Files:**
- Modify: `src/backend/services/order/index.ts` and `index.test.ts`, and `src/backend/services/customer/index.ts` (orders in the timeline and in the merge)
- Create: `src/backend/validators/order.validator.ts`, `src/app/api/orders/route.ts`, `src/app/api/orders/[slug]/route.ts`, and route tests
- Modify: `types/index.ts` (`OrderDto`) and `src/utils/labels.ts` and `labels.test.ts`

**Interfaces:**
- Consumes: `returnStock` and `emailService.sendOrderEmail`.
- Produces:
  - `orderService.list(businessId, { status?: "NEW" | "READY" | "COMPLETED" | "CANCELLED"; page: number; size: number })`. It never returns `AWAITING_PAYMENT`.
  - `orderService.getBySlug(businessId, slug)`
  - `orderService.setStatus(businessId, slug, to: "READY" | "COMPLETED" | "CANCELLED"): Promise<Order>`
  - `orderService.setFulfilment(businessId, slug, { fulfilment, deliveryAddress? }): Promise<Order>`
  - `orderStatusLabel(status, fulfilment): string`
  - `GET /api/orders?status=&page=`
  - `GET /api/orders/[slug]`
  - `PUT /api/orders/[slug]` takes `{ status? } | { fulfilment, deliveryAddress? }`.

- [ ] **Step 1: Write the failing tests.**

```ts
expect(orderStatusLabel("READY", "PICKUP")).toBe("Ready for pickup");
expect(orderStatusLabel("READY", "DELIVERY")).toBe("Out for delivery");
expect(orderStatusLabel("COMPLETED", "PICKUP")).toBe("Collected");
expect(orderStatusLabel("COMPLETED", "DELIVERY")).toBe("Delivered");
expect(orderStatusLabel("NEW", "PICKUP")).toBe("New");
expect(orderStatusLabel("AWAITING_PAYMENT", "PICKUP")).toBe("Awaiting payment");
it.each([["NEW","READY"],["NEW","COMPLETED"],["READY","COMPLETED"],["NEW","CANCELLED"],["READY","CANCELLED"]])("allows %s → %s", ...)
it.each([["COMPLETED","READY"],["CANCELLED","READY"],["AWAITING_PAYMENT","READY"]])("refuses %s → %s", ...) // BadRequestException
it("puts stock back when an order is cancelled", ...)
it("emails the customer ready, completed or cancelled", ...)
it("lists orders without awaiting-payment ones", ...)
it("adds orders to the customer's timeline", ...) // label "Order ORD-1022", href "/orders/<publicId>"
```

- [ ] **Step 2: Run** `yarn test src/backend/services/order src/utils/labels src/app/api/orders`. Expected: FAIL.

- [ ] **Step 3: Implement the methods and routes.** Set `readyAt`, `completedAt` and `cancelledAt` as the status changes.

- [ ] **Step 4: Run** `yarn test` (expected PASS) and `yarn typecheck`.

- [ ] **Step 5: Commit** with `git commit -m "feat(orders): mark orders ready, completed or cancelled"`

### Task 16: Product page, checkout sheet and customer order page

**Files:**
- Create:
  - `src/server/product-page.ts`, `src/server/product-page.test.ts`
  - `src/utils/product-page.ts`, `src/utils/product-page.test.ts`
  - `src/server/order-page.ts`
  - `src/app/(public)/products/[slug]/{page,opengraph-image,not-found,loading}.tsx`
  - `src/app/(public)/orders/[publicId]/{page,not-found,loading}.tsx`
  - `src/components/public/product-profile.tsx`, `photo-gallery.tsx`, `option-chips.tsx`, `checkout-sheet.tsx`, `order-page.tsx`. There is no checkout route: checkout is a sheet on the product page.
- Modify:
  - `src/server/og.tsx`: add `productCard`
  - `src/server/link-cards.ts`: add `"product"` to `LinkCardKind`, add `["products", "product"]` to `SEGMENTS`, and add `RENDER.product`
  - `src/server/index.ts`: export `getProductPage` and `getPublicOrder`

**Interfaces:**
- Consumes: `availableStock`, `canSellOnline`, `optionLabel`, `api.public.order`, `orderStatusLabel`, and `AwaitConfirmation` from `src/components/book/await-confirmation.tsx`.
- Produces:
  - `type ProductPage = { slug; name; description; photos: string[]; price: string; currency; businessName; area: string | null; canBuy: boolean; offersDelivery: boolean; deliveryFee: string | null; offersPickup: boolean; pickupAddress: string | null; options: { id; name; price: string; available: number | null }[] }`
  - `getProductPage(slug: string): Promise<ProductPage | null>`, which returns null for an unknown or paused product
  - `availabilityNote(available: number | null): string | null`
  - `productMetadata(page: ProductPage | null, path: string): Metadata`
  - `getPublicOrder(publicId: string)`
  - `productCard(page: ProductPage): Promise<Response>`

- [ ] **Step 1: Write the failing tests.**

```ts
expect(availabilityNote(3)).toBe("Only 3 left");   // the note starts at LOW_STOCK (3)
expect(availabilityNote(4)).toBeNull();
expect(availabilityNote(0)).toBe("Sold out");
expect(availabilityNote(null)).toBeNull();
it("getProductPage subtracts held stock per option", ...)
it("getProductPage returns null for a paused product", ...)
it("getPublicOrder keeps each line's name after its option is removed", ...) // option isActive false → line name 'Frontal wig — 20"' still returned
it("cardFor reads a product link", ...) // cardFor(`${base}/products/frontal-wig`) → { kind: "product", id: "frontal-wig" }
```

- [ ] **Step 2: Run** `yarn test src/utils/product-page src/server`. Expected: FAIL.

- [ ] **Step 3: Implement the loaders and helpers. Then invoke the impeccable skill and build the pages to the UI direction's "Product page", "Checkout sheet" and "Customer order page" entries.**
  - The photo gallery is a scroll-snap list of square frames with alt text. Its dots are buttons that scroll to their photo.
  - Option chips preselect the first available option. The stepper is capped at `available`, and a null `available` means no cap.
  - "Buy now · NGN X" opens the checkout sheet. The sheet posts `api.public.order`, then sends the browser to `paymentUrl`. A 409 lowers the cap and shows the message above the button.
  - The order page shows `orderStatusLabel`, the lines, the fulfilment and address, and the receipt link. While the order is `AWAITING_PAYMENT`, it shows `AwaitConfirmation`.

- [ ] **Step 4: Verify.**
  - `yarn test` and `yarn typecheck` pass.
  - Run `.agents/skills/impeccable/scripts/impeccable detect --json src/components/public src/app/\(public\)/products src/app/\(public\)/orders` once and fix what it reports.
  - In `yarn dev` with Paystack test keys, at 375px and 1440px: swipe through three photos, pick a sold-out option (it can't be picked), then buy end to end through the sheet. The customer lands on `/orders/<publicId>` and sees "New", the owner gets the WhatsApp alert, and stock drops by the quantity.
  - `curl -A "WhatsApp/2.0" http://localhost:3000/products/<slug>` returns card tags, and `/products/<slug>/opengraph-image` returns a JPEG.

- [ ] **Step 5: Commit** with `git commit -m "feat(products): product page, checkout and customer order page"`

### Task 17: Orders screen

**Files:**
- Create:
  - `src/app/(app)/orders/page.tsx`
  - `src/components/orders/orders-page-client.tsx`, `order-row.tsx` (actions on the row, no pop-up), `order-row.test.tsx`
  - `src/hooks/queries/use-orders.ts` and `src/hooks/mutations/use-order-mutations.ts`
- Modify: `src/utils/api.ts` (`api.orders.{list, get, update}`)

**Interfaces:**
- Consumes: the Task 15 endpoints and `orderStatusLabel`.

- [ ] **Step 1: Write the failing row test.**

```ts
it("shows number, customer, items, total and status label", ...) // "ORD-1022", "Tolu Adeyemi", '2 × Frontal wig — 20"', "NGN 93,000", "Out for delivery"
it("links the customer's phone", ...)                            // href "tel:+2348035550142"
it.each([["NEW","PICKUP","Mark ready"],["READY","PICKUP","Mark collected"],["READY","DELIVERY","Mark delivered"]])(
  "offers the next step for %s %s", ...)                         // button text equals the third value
it("offers no next step on a completed or cancelled order", ...)
it("flags an oversold order", ...)                               // contains "Oversold" and "Paid after it sold out. Restock or refund."
```

- [ ] **Step 2: Run** `yarn test src/components/orders`. Expected: FAIL.

- [ ] **Step 3: Invoke the impeccable skill, then build the screen to the UI direction's "Orders" entry, copying `booking-row.tsx`.**
  - Use a `Segmented` filter (To send out, Done, Cancelled) with `Pager` and `Skeleton` rows.
  - Each row carries its own actions: the next step, Cancel (with `ConfirmModal`) and the copy-link icon for the customer's order page.
  - An invoice order shows "From INV-1042". Its "Change to delivery" opens an address field in place, and saving calls `api.orders.update(slug, { fulfilment, deliveryAddress })`.
  - The empty state is the UI direction's Orders line.

- [ ] **Step 4: Verify.**
  - `yarn test` and `yarn typecheck` pass.
  - Run `.agents/skills/impeccable/scripts/impeccable detect --json src/components/orders` once and fix what it reports.
  - In `yarn dev` at 375px and 1440px: move an order New → Ready → Delivered from its row, cancel another and see its stock come back, and switch an invoice order to delivery.

- [ ] **Step 5: Commit** with `git commit -m "feat(orders): orders screen for the owner"`

### Task 18: Owner alerts outside WhatsApp's 24-hour window

**Files:**
- Modify:
  - `src/backend/services/messaging/channels/types.ts`, `whatsapp/index.ts` and its test, `instagram/index.ts`
  - `src/backend/services/messaging/notify/index.ts` and its test
  - `src/env.js` and `.env.example`

**Interfaces:**
- Produces:
  - `type SendResult = { ok: true } | { ok: false; code: number | null }`. `ChannelAdapter.send` now resolves to `SendResult`.
  - `whatsAppAdapter.sendTemplate(externalId: string, template: { name: string; language: string; bodyParams: string[] }): Promise<SendResult>`
  - The env variables `WHATSAPP_ALERT_TEMPLATE` (optional) and `WHATSAPP_ALERT_TEMPLATE_LANGUAGE` (optional, default `"en"`).

- [ ] **Step 1: Write the failing tests.**

```ts
it("returns Meta's error code when a send fails", ...)  // fetch → 400 { error: { code: 131047 } } → { ok: false, code: 131047 }
it("sends the alert template when the 24-hour window is closed", ...) // send → code 131047, env template "sara_alert" → sendTemplate called with bodyParams [text]
it("puts no line breaks in a template parameter", ...)  // "a\nb" → bodyParams ["a · b"]
it("doesn't fall back without a template configured", ...)
it("doesn't fall back for other errors", ...)
```

- [ ] **Step 2: Run** `yarn test src/backend/services/messaging`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - The template payload is `{ messaging_product: "whatsapp", to, type: "template", template: { name, language: { code }, components: [{ type: "body", parameters: bodyParams.map(text => ({ type: "text", text })) }] } }`.
  - Meta refuses newlines and tabs in a parameter, so replace newlines with " · ".
  - Callers that ignored `send`'s result keep ignoring it.

- [ ] **Step 4: Run** `yarn test` (expected PASS) and `yarn typecheck`.

- [ ] **Step 5: Commit** with `git commit -m "feat(whatsapp): send owner alerts as a template outside the 24-hour window"`

## Phase 4: Invoices and receipts that sell products

### Task 19: Products in the invoice and receipt composer

**Files:**
- Modify: `src/hooks/use-document-composer.ts`, `src/components/documents/document-modal.tsx`, `src/utils/documents.ts` and `documents.test.ts` (`documentToFormValues`), and `src/backend/validators/document-form.validator.ts`

**Interfaces:**
- Consumes: `useProductsQuery`, `optionLabel` and `stockBadge`.
- Produces:
  - Composer lines carry `productOptionId`.
  - The receipt form adds a "This is a delivery" checkbox and `deliveryAddress`, shown only when the receipt has a product line.
  - The receipt create payload gains `sale?: { fulfilment: "DELIVERY" | "PICKUP"; deliveryAddress?: string | null }`.

- [ ] **Step 1: Write the failing tests.**

```ts
it("round-trips a product line through documentToFormValues", ...) // productOptionId kept, name 'Frontal wig — 20"'
it("warns when a receipt sells more than is in stock", ...)        // composer helper stockWarning(lines, products) → 'Only 9 Shea butter 250ml in stock'
```

- [ ] **Step 2: Run** `yarn test src/utils/documents src/hooks`. Expected: FAIL.

- [ ] **Step 3: Implement to the UI direction's item-picker entry.**
  - The item picker lists services, then each active product option under a "Products" heading, labelled like `Frontal wig — 20" · NGN 45,000 · 11 in stock`.
  - A sold-out option can still be picked on an invoice. A receipt line that sells more than is in stock shows the warning in place, and saving is still allowed.

- [ ] **Step 4: Verify.**
  - `yarn test` and `yarn typecheck` pass.
  - Run `.agents/skills/impeccable/scripts/impeccable detect --json src/components/documents/document-modal.tsx` once and fix what it reports.
  - In `yarn dev` at 375px, create an invoice with a product line and a service line.

- [ ] **Step 5: Commit** with `git commit -m "feat(documents): pick products in the invoice and receipt composer"`

### Task 20: Receipts and paid invoices create orders

**Files:**
- Modify:
  - `src/backend/services/order/index.ts` and `index.test.ts`
  - `src/backend/services/receipt/index.ts` and `src/backend/validators/receipt.validator.ts` (`sale`)
  - `src/app/api/invoices/[slug]/route.ts` and its test: first payment, and void with `cancelOrder`
  - `src/backend/selects.ts` (`invoiceListInclude.order`) and `types/index.ts` (`InvoiceDto.order`)
  - `src/utils/api.ts` (`setStatus(slug, status, opts?: { cancelOrder?: boolean })`)
  - `src/components/invoices/invoices-page-client.tsx`: the void confirmation offers the order cancel

**Interfaces:**
- Consumes: `takeStock`, `returnStock`, `nextOrderNumber` and `orderService.setStatus`.
- Produces:
  - `orderService.createFromReceipt(client: Prisma.TransactionClient, receipt: { id; businessId; customerId; currency; name; phone; email; amountPaid: number; paymentMethod: PaymentMethod | null; lines: ResolvedLine[] }, sale: { fulfilment: "DELIVERY" | "PICKUP"; deliveryAddress?: string | null }): Promise<Order | null>`. It returns null when there are no product lines.
  - `orderService.createFromInvoice(client: Prisma.TransactionClient, invoiceId: string): Promise<Order | null>`. It's idempotent on `Order.invoiceId`.

- [ ] **Step 1: Write the failing tests.** Review Focus #5.

```ts
it("a receipt with product lines records a collected sale", ...) // order COMPLETED, source RECEIPT, takeStock called, payment { amount: amountPaid, method: "CASH" when null }, receipt.paymentId set
it("a delivery receipt starts the order as NEW", ...)
it("a receipt made for an existing payment creates no order", ...) // input.paymentId set → createFromReceipt not called
it("a receipt with only service lines creates no order", ...)
it("an invoice's first payment creates the order and takes stock once", ...) // amountPaid 0 → 20000 → createFromInvoice
it("a second part payment doesn't create another order", ...)               // amountPaid 20000 → 50000 → order exists → no takeStock
it("voiding with cancelOrder cancels the order and puts stock back", ...)
it("voiding without cancelOrder leaves the order alone", ...)
```

- [ ] **Step 2: Run** `yarn test src/backend/services/order src/backend/services/receipt src/app/api/invoices`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `receiptService.create` calls `createFromReceipt` inside its transaction when `!input.paymentId`.
  - `PUT /api/invoices/[slug]` calls `createFromInvoice` when the stored `amountPaid` was 0 and the new one is above 0.
  - A void request with `cancelOrder: true` calls `orderService.setStatus(…, "CANCELLED")` when the order isn't completed.
  - Invoice orders start as `fulfilment: "PICKUP"`.

- [ ] **Step 4: Run** `yarn test` (expected PASS) and `yarn typecheck`.

- [ ] **Step 5: Commit** with `git commit -m "feat(orders): receipts and paid invoices create orders"`

### Task 21: Paying an invoice online

**Files:**
- Create: `src/backend/services/invoice/payment.ts`, `payment.test.ts`, `src/app/api/public/invoices/[publicId]/pay/route.ts`, `route.test.ts`, `src/components/documents/pay-invoice-button.tsx`
- Modify:
  - `src/app/api/webhooks/paystack/route.ts`: dispatch on `metadata.invoiceId`; GET handles `?i=<publicId>` and invoice-linked payments
  - `src/server/documents.ts` and `src/utils/shared-document.ts`: `SharedDocument.payable`
  - `src/components/documents/shared-document-page.tsx`
  - `src/utils/api.ts`: `api.public.payInvoice(publicId)`

**Interfaces:**
- Consumes: `orderService.createFromInvoice`, `receiptService.create`, `ownerNotifier.notify` and `SuccessfulPaymentData`.
- Produces:
  - `invoicePayments.start(publicId: string): Promise<{ paymentUrl: string }>`
  - `invoicePayments.process(data: SuccessfulPaymentData): Promise<{ invoice: { publicId: string } } | null>`
  - `SharedDocument.payable: { amount: number; currency: string } | null`
  - `POST /api/public/invoices/[publicId]/pay` returns `{ data: { paymentUrl } }`.

- [ ] **Step 1: Write the failing tests.** Review Focus #2 for invoices.

```ts
it("charges the whole remaining balance", ...)     // total 50000, paid 20000 → amount 3000000 kobo, metadata.invoiceId, callback "?i=<publicId>"
it.each(["DRAFT", "PAID", "VOID"])("refuses a %s invoice", ...) // BadRequestException("This invoice can't be paid online")
it("refuses when the business can't take payments", ...)
it("a part payment leaves the invoice PARTIALLY_PAID", ...)
it("a full payment marks it PAID with paidAt", ...)
it("ignores a reference it has already recorded", ...)
it("creates the order on the first payment of a product invoice", ...)
it("alerts the owner", ...)                        // "💳 INV-1042 paid · Tolu Adeyemi · NGN 30,000"
it("payable is null for paid, void and draft invoices", ...)
```

- [ ] **Step 2: Run** `yarn test src/backend/services/invoice src/app/api/public/invoices src/server`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `process` runs one transaction: Payment (`PAYSTACK`, `invoiceId`, `customerId`), then `amountPaid`, `status` and `paidAt`.
  - After it, `createFromInvoice`, the receipt with `paymentId` (which copies the invoice lines), the owner alert, and `emailReceipt`.
  - Build the button to the UI direction's "Invoice Pay button" entry: "Pay NGN 30,000 with Paystack". On phones it sits in the fixed bottom bar copied from `ServiceProfile`; from `lg` it's a large button under the document. It's shown only when `payable` isn't null.

- [ ] **Step 4: Verify.**
  - `yarn test` and `yarn typecheck` pass.
  - Run `.agents/skills/impeccable/scripts/impeccable detect --json src/components/documents` once and fix what it reports.
  - In `yarn dev` with Paystack test keys, at 375px and 1440px: pay a part-paid invoice and see it turn Paid, with a receipt and an alert.

- [ ] **Step 5: Commit** with `git commit -m "feat(invoices): customers can pay an invoice online"`

## Phase 5: Today page, chat menu and product notes

### Task 22: Today page for merchants

**Files:**
- Create: `src/utils/menu.ts`, `src/utils/menu.test.ts`, `src/components/dashboard/share-link-sheet.tsx`
- Modify:
  - `src/backend/services/dashboard/index.ts` and `index.test.ts`
  - `types/index.ts` (`DashboardData`)
  - `src/components/dashboard/dashboard-page-client.tsx` and `revenue-bars.tsx`
  - `src/components/dashboard/panel.tsx`: `n` becomes optional, and a panel without it shows no number
  - `src/app/(app)/dashboard/page.tsx`: passes `sells`, plus services and products for the share sheet

**Interfaces:**
- Produces:
  - `type MenuAction = "NEW_INVOICE" | "NEW_RECEIPT" | "SHARE_LINK" | "UNPAID" | "TODAY_BOOKINGS" | "SUMMARY" | "ORDERS_TO_SEND"`
  - `MENU: Record<"SERVICES" | "PRODUCTS" | "BOTH", { action: MenuAction; label: string }[]>`. It's client-safe and shared by the Today page and the chat engine (Task 23).
  - `menuNumber(sells, action: MenuAction): number | null`
  - `type ItemRevenue = { kind: "SERVICE" | "PRODUCT"; id: string; name: string; slug: string; totalRevenue: number; count: number }`
  - `dashboardService.revenueByItem(businessId): Promise<ItemRevenue[]>`
  - `dashboardService.ordersToSendOut(businessId): Promise<{ slug: string; orderNumber: string; clientName: string; status: "NEW" | "READY"; fulfilment: "DELIVERY" | "PICKUP"; total: number }[]>`
  - `dashboardService.runningLow(businessId): Promise<{ productSlug: string; label: string; stock: number }[]>`
  - `DashboardData.revenueByService` is replaced by `revenueByItem: ItemRevenue[]`, and the type gains `ordersToSendOut` and `runningLow`.

- [ ] **Step 1: Write the failing tests.**

```ts
expect(MENU.SERVICES.map((m) => m.label)).toEqual(["New invoice", "New receipt", "Share a service (booking link)", "Unpaid invoices", "Today's bookings", "Business summary"]);
expect(menuNumber("SERVICES", "TODAY_BOOKINGS")).toBe(5);
expect(menuNumber("PRODUCTS", "ORDERS_TO_SEND")).toBe(5);
expect(menuNumber("BOTH", "ORDERS_TO_SEND")).toBe(7);
expect(menuNumber("PRODUCTS", "TODAY_BOOKINGS")).toBeNull();
it("merges service and product revenue, highest first", ...) // products summed from OrderLine.total of NEW/READY/COMPLETED orders, count = quantity
it("includes options with exactly 3 left and leaves out 4", ...)
it("leaves untracked and paused products out of running low", ...)
it("lists New and Ready orders oldest first, at most 10", ...)
```

- [ ] **Step 2: Run** `yarn test src/utils/menu src/backend/services/dashboard`. Expected: FAIL.

- [ ] **Step 3: Implement `menu.ts` and the dashboard methods. Then invoke the impeccable skill and build the page to the UI direction's "Today" entry.**
  - Every numbered section and action takes its number from `menuNumber(sells, …)`, so the Today page keeps matching the chat.
  - **Action 3:** "Share a service" (SERVICES, links to `/services`), "Share a link" (PRODUCTS, links to `/products`), or "Share a link" opening `share-link-sheet.tsx` (BOTH). The sheet lists every active service and product with its `CopyLinkButton`.
  - **Panels:**
    - "Orders to send out" links to `/orders`.
    - "Running low" has no number, links to `/products`, and shows only when the list isn't empty.
    - "Revenue by service" becomes "Revenue by item" and lists services and products together.
  - A SERVICES business sees today's layout with only the revenue panel renamed.

- [ ] **Step 4: Verify.**
  - `yarn test` and `yarn typecheck` pass.
  - Run `.agents/skills/impeccable/scripts/impeccable detect --json src/components/dashboard` once and fix what it reports.
  - The Today page renders for a SERVICES, a PRODUCTS and a BOTH business at 375px and 1440px, and its numbers match each business's chat menu.

- [ ] **Step 5: Commit** with `git commit -m "feat(dashboard): orders to send out, running low and revenue by item"`

### Task 23: Chat menu for merchants, customer matching in chat, and PRODUCT.md

**Files:**
- Modify: `src/backend/services/messaging/engine/index.ts` and `index.test.ts`, `src/backend/services/messaging/dispatch/index.ts` and `index.test.ts`, `src/backend/services/customer/index.ts` (`findByName`), and `PRODUCT.md`

**Interfaces:**
- Consumes: `MENU` and `MenuAction` from `src/utils/menu.ts` (Task 22), `customerService`, `productService`, `stockBadge`, `productLink`, `optionLabel` and `dashboardService.ordersToSendOut`.
- Produces:
  - `mainMenuText(sells: BusinessSells): string`, built from `MENU[sells]`
  - `intentDispatcher.listItemOptions(businessId): Promise<ItemOption[]>`. `ItemOption` is `FullServiceOption` plus `kind: "SERVICE" | "PRODUCT"` and `productOptionId?`. It replaces `listFullServiceOptions`.
  - `intentDispatcher.listShareOptions(businessId): Promise<{ kind: "SERVICE" | "PRODUCT"; slug: string; label: string }[]>`
  - `intentDispatcher.productLinkText(slug: string): string`
  - `intentDispatcher.ordersToSendOutText(businessId): Promise<string>`
  - `customerService.findByName(businessId, name): Promise<{ exact: Customer | null; similar: Customer[] }>`
  - `WriteDraft.customerId?: string`

- [ ] **Step 1: Write the failing tests.**

```ts
it("keeps the services-only menu exactly as it is today", () =>
  expect(mainMenuText("SERVICES")).toBe("Sara 👋  Reply with a number:\n1️⃣ New invoice\n2️⃣ New receipt\n3️⃣ Share a service (booking link)\n4️⃣ Unpaid invoices\n5️⃣ Today's bookings\n6️⃣ Business summary"));
it("gives a products business orders to send out at 5", ...) // "3️⃣ Share a link", "5️⃣ Orders to send out", "6️⃣ Business summary"
it("gives a business that does both seven items", ...)        // "7️⃣ Orders to send out"
it("labels products in the share list with stock", ...)       // 'Frontal wig — NGN 45,000 (11 in stock)'
it("writes a product link message", ...)                      // "Share this product link with your customer:\n<link>\n— — —\nHi! You can buy it here: <link>\n— — —"
it("links the one exact name match without asking", ...)
it("asks which customer when names are similar", ...)         // "Which customer?\n1. Tolu Adeyemi · +2348035550142\n2. Tolu Bakare\n3. New customer"
it("lists orders to send out", ...)                           // "1. ORD-1022 · Tolu Adeyemi · Delivery · New"; empty → "✅ Nothing to send out."
it("offers product options in the invoice item list", ...)
```

- [ ] **Step 2: Run** `yarn test src/backend/services/messaging src/backend/services/customer`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - The engine reads `business.sells` with the identity, and routes numbers through `MENU[sells]`.
  - The "Customer's name?" step:
    - one exact `nameKey` match links that customer silently
    - customers whose name starts with the typed words get a numbered choice with "New customer" last (new state `${kind}_CUSTOMER_PICK`)
    - otherwise it carries on with a new name.
  - `findByName` returns `exact` (an equal `nameKey`) and `similar` (a `nameKey` starting with the typed key plus a space), at most 5.

- [ ] **Step 4: Update `PRODUCT.md`.**
  - Users: add merchants who sell products.
  - Capabilities: products with options and stock, product links and checkout, orders, the customer list, online invoice payment.
  - Operating Context: the menu per business type.
  - "Does NOT exist yet": remove anything this plan built, and add a shop page, a cart, discount codes, profit reports, delivery company integrations and refunds through Sara.
  - Leave the "not AI" rule alone. The companion spec changes it.

- [ ] **Step 5: Verify.** `yarn test`, `yarn typecheck` and `yarn lint` pass. On the test WhatsApp number, a SERVICES business's menu reads exactly as before, and a PRODUCTS business can share a product link and list orders to send out.

- [ ] **Step 6: Commit**

```bash
git add src PRODUCT.md
git commit -m "feat(chat): menu for merchants, product links and customer matching"
```

### Task 24: Impeccable review of the new screens

**Files:**
- Modify: whichever new-screen files the review's findings point at.
- Modify: `.gitignore`, adding `.impeccable/review/` (`.impeccable/design.json` is tracked; the screenshots must not be).
- Screenshots go in `.impeccable/review/merchants/`.

- [ ] **Step 1: Seed and capture.**
  - In `yarn dev`, set up three businesses (SERVICES, PRODUCTS and BOTH) with realistic data:
    - three products: one with three options and photos, one made to order, one sold out
    - five orders across statuses, including an oversold one and one from an invoice
    - eight customers, including one with a long name.
  - Capture each new screen at 375×812 and at 1440×900:
    - Today
    - Customers, and one customer's page
    - Products, and the product editor sheet
    - Orders
    - Settings → Selling
    - the product page and the checkout sheet
    - a customer order page, awaiting payment and paid
    - an unpaid invoice with its Pay button.
  - Open each capture once to check it shows what its name says.
- [ ] **Step 2: Review.** Invoke the impeccable skill and run `audit` over `src/components/{customers,products,orders,public,dashboard,settings,documents}` (accessibility, responsiveness, performance). Then run `critique` on the captures against this plan's UI direction.
- [ ] **Step 3: Fix the material findings in one batch.** Recapture the same screens once to confirm, then stop. Anything still open goes to the owner as a list instead of another round.
- [ ] **Step 4: Verify.** Run `.agents/skills/impeccable/scripts/impeccable detect --json` once over the changed UI directories (expected: no findings), then `yarn test`, `yarn typecheck` and `yarn lint`.
- [ ] **Step 5: Commit**

```bash
git add .gitignore src
git commit -m "fix(ui): impeccable review fixes for the merchant screens"
```

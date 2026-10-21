# Merchants: Products, Orders and Customers — Design

**Date:** 2026-10-21
**Status:** Draft design, awaiting the owner's approval
**Companion spec:** `2026-10-21-talk-to-sara-voice-notes-design.md` (built after this one; its
assistant uses the product, order and customer actions defined here)

## Summary

Sara runs the back office for one-person service businesses: services, bookings, invoices,
receipts and Paystack payments that settle into the business's own subaccount. This design
opens Sara to **merchants who sell products**, the way Fisco (usefisco.com) serves product
sellers, service businesses and businesses that do both from one account.

A merchant lists products with photos, options (size, length, colour) and stock. Each product
gets a shareable link, like a service does today. The customer picks an option, a quantity,
and pickup or delivery, then pays through Paystack into the merchant's account. Every paid sale
becomes an **order** that the merchant moves from New to Ready to Delivered or Collected. Every
business gets a **customer list**. Invoices and receipts can list products, and customers can
pay an invoice online.

## Why

- The owner wants Sara to serve sellers, not just service providers, the way Fisco does.
- Merchants in Lagos sell through Instagram and WhatsApp DMs. They need a link to send,
  payment straight to their own account, stock that stays right, and a list of what to send out.
- Sara keeps customer details only as snapshots on each booking, invoice, receipt and payment,
  so there is nowhere to see one customer's history or what they owe.

## Decisions (settled during brainstorming)

"Owner" means the owner said it. "Approved" means the owner approved a proposal, mostly through
the mockups.

| Question | Decision | Source |
| --- | --- | --- |
| Who is it for? | Service businesses stay. Merchants who sell products are added. A business can do both. | Owner |
| How are products sold? | Each product gets its own shareable link, like a service. The customer pays through Paystack and the money settles into the merchant's own account. | Owner |
| Options | A product can come in options such as size, length or colour. Each option keeps its own stock count. | Approved |
| Fulfilment | At checkout the customer picks pickup or delivery. Delivery asks for an address and adds one flat delivery fee that the merchant sets. | Approved |
| Stock | Stock goes down when an order is paid or the owner records a sale, and back up when an order is cancelled. An unpaid checkout holds its items for 30 minutes, like an unpaid booking holds its slot. A product that runs out shows "Sold out". | Approved |
| Orders | Every paid sale becomes an order: online checkouts, sales the owner records (walk-in or DM, cash or transfer), and paid invoices that include products. Orders go New → Ready → Delivered or Collected. The customer gets an email at each step. Sara never messages customers on WhatsApp. | Approved |
| Shopping cart | None. A DM customer who wants several things gets one invoice listing all of them. | Approved |
| Invoices and receipts | Can list products as well as services. | Approved |
| Customers | Every business gets a customer list. A customer's page shows what they bought and booked, what they spent and what they owe. Sara recognises a returning customer by phone number or email. | Approved |
| Sign-up | The owner says whether they sell services, products or both, and the dashboard shows the sections that fit. Web sign-up already works and stays. | Approved |
| Left out | A shop page listing everything, cost prices and profit reports, discount codes, staff accounts, links to delivery companies. | Approved |

## Calls I made (not discussed; check these)

1. **Invoices get a Pay button.** The customer invoice page has no way to pay today: the owner
   records payments by hand. The approved WhatsApp flow hands the owner a "pay link" for a new
   invoice, and multi-product DM orders are paid through an invoice, so the invoice page gets a
   Paystack "Pay" button for the remaining balance.
2. **A receipt that lists products is how a walk-in or DM sale is recorded.** It takes the stock
   and creates an order that is already complete. There is no separate "record a sale" form.
3. **Stock tracking can be switched off per product**, for made-to-order goods such as cakes or
   tailoring. Untracked products never sell out.
4. **One list of options per product**, each with its own stock and an optional price that
   overrides the product price. Two-way options such as colour and size are typed as combined
   names ("Red / M"). There's no option grid.
5. **Up to five photos per product.** The first one is used for the WhatsApp link card.
6. **Delivery and pickup are business settings:** "Offer delivery" with one flat fee, and
   "Offer pickup" from the business address. At least one must be on before products can be
   bought online.
7. **Checkout asks for name and phone** (required), email (optional, but needed for the emails),
   and an address when the customer picks delivery.
8. **Order statuses** are Awaiting payment (an online checkout that is holding stock), New, Ready,
   Completed (shown as "Delivered" or "Collected") and Cancelled.
9. **Cancelling an order puts the stock back.** Refunds happen outside Sara, in Paystack.
10. **A payment that arrives after its hold expired, when the stock has since sold out**, still
    creates a paid order. The order is marked "Oversold" and the owner is alerted. Sara never
    drops a paid order.
11. **A paid invoice that lists products** creates its order and takes the stock at the invoice's
    first payment, whether part or full.
12. **Customer matching** checks phone first, then email. A record with neither is matched by
    exact name, but only when exactly one customer has that name. The chat only asks for a name
    today, so this matters. The owner can merge duplicates.
13. **Owner alerts for paid orders use an approved WhatsApp template.** WhatsApp only allows
    free-form messages within 24 hours of the owner's last message. Today's booking payment
    alerts have the same gap and move to the template too.
14. **The chat menu adapts to what the business sells.** "Share a service" becomes "Share a
    link", which lists products as well as services. Product sellers get "Orders to send out".
    The invoice and receipt item lists include products.
15. **Low stock means 3 or fewer left of an option** on a product that tracks stock. The Today
    page lists those options.
16. **Order numbers run ORD-1001, ORD-1002, … per business**, like invoices and receipts.
17. **URLs:** `/products/<slug>` is the product page and `/products/<slug>/checkout` is checkout,
    as in the approved mockup. `/orders/<publicId>` is the customer's order page, like
    `/bookings/<publicId>`.

## Goals

- A merchant adds a product on their phone, with photos, price, options and stock, in a couple
  of minutes.
- They share one link per product. The customer chooses an option, a quantity, and pickup or
  delivery, then pays, and the money lands in the merchant's subaccount.
- Every paid sale shows up as an order saying what to send and where, whether it came from a
  link, a receipt or an invoice.
- Stock stays right:
  - nothing out of stock can be bought online
  - two customers can't both pay for the last one
  - cancelled orders put stock back.
- Every business has one customer list. Each customer's page shows their bookings, orders,
  invoices and receipts, what they spent and what they owe.
- Service-only businesses see no change except the customer list and the Pay button on
  invoices.

## Non-goals

- A shop page listing all of a business's products and services.
- A shopping cart, or buying several different products in one online checkout.
- Product categories or collections.
- Cost prices, profit, or margin reports.
- Discount codes and coupons.
- Staff accounts, roles, or multiple branches.
- Delivery company integrations, or delivery fees by distance or zone.
- Refunds through Sara.
- Customer accounts or logins, reviews, wishlists.
- Stablecoin payments.
- Any WhatsApp message to a customer.

## Anti-goals (what would make this a failure even if it works)

- A customer pays and no order is recorded.
- Stock that isn't there gets sold and the owner isn't told.
- Bookings, invoices or receipts behave differently for an existing service business.
- Money passes through Sara's own account instead of the merchant's subaccount.
- A product page that is slow or heavy on a phone with patchy data.

## Constraints

- All UI follows `DESIGN.md` and the design rules in `CLAUDE.md`: Tailwind tokens, green only as
  a fill, phone-first at 375px.
- Money format follows `PRODUCT.md`: "NGN 15,000" in UI chrome and "₦15,000" in headline and
  stat copy.
- Payments use the existing Paystack split into the business's subaccount
  (`src/backend/services/paystack`).
- Customers hear from Sara by email only (Resend, `src/backend/services/email`).
- Routes, services and hooks follow `BACKEND_PATTERNS.md` and `FRONTEND_PATTERNS_GUIDE.md`, with
  OpenAPI JSDoc for `next-openapi-gen`.
- Copy may only claim what exists. Update the `PRODUCT.md` "Does NOT exist yet" list when this
  ships.

## Data model

These are shapes, not final names. The builder chooses names and indexes.

- **Business** gets:
  - `sells`: SERVICES, PRODUCTS or BOTH. Existing rows become SERVICES.
  - `offersDelivery` and `deliveryFee`.
  - `offersPickup`. Pickup uses the existing address fields.
- **Customer**, new, scoped to a business:
  - name, phone (normalised to E.164 with Nigeria as the default country), email (lower-cased),
    the last delivery address, optional notes, and timestamps
  - phone is unique per business when set, and so is email.
- **Booking, Invoice, Receipt, Payment and Order** each get a nullable `customerId`. The existing
  name, phone and email snapshots stay: they record what was on that document.
- **Product**, new:
  - slug, globally unique like `Service.slug` and generated the same way
    (e.g. `tobi-frontal-wig`)
  - business, name, description, price, up to five photo URLs in order (Cloudinary), a
    track-stock flag (default on), active flag, and timestamps.
- **Product option**, new:
  - product, name (e.g. `20"`), optional price override, stock (an integer that never goes below
    zero), position, active flag
  - a product without options has one unnamed default option, so stock and order lines always
    point at an option.
- **Order**, new:
  - slug, `publicId` (16-character nanoid, like bookings), business, customer
  - order number (ORD-1001 per business)
  - status: AWAITING_PAYMENT, NEW, READY, COMPLETED or CANCELLED
  - source: ONLINE, RECEIPT or INVOICE
  - fulfilment: DELIVERY or PICKUP
  - delivery address, delivery fee, subtotal, total
  - `holdExpiresAt`, an oversold flag, optional links to the invoice and receipt
  - customer snapshot, a timestamp for each status change, notes.
- **Order line**, new: order, product option, a name snapshot (`Frontal wig — 20"`), quantity,
  unit price, total.
- **Invoice and receipt lines** become general line tables with their own id:
  - each line points at a service, a product option, or neither (a custom line), with
    description, quantity, unit price and total
  - today `InvoiceService` and `ReceiptService` use a composite key on (document, service), so a
    document can't hold two lines for the same service and can't hold a product at all.
- **Payment** gets a nullable `orderId`, like `bookingId`.

### Migration and backfill

- Prisma migrations add the new tables and columns. Existing `InvoiceService` and
  `ReceiptService` rows move one-to-one into the new line tables, and existing documents must
  render and total exactly as before.
- A one-off backfill creates customers from existing bookings, invoices, receipts and payments
  using the matching rules below, then links the records. It must be safe to run twice.

## Selling a product

### Product page: `/products/<slug>`

The page shows:

- photos, the business name and area, product name and price
- option chips: sold-out options are struck through and can't be picked
- "Only N left" when a stock-tracked option has 3 or fewer
- a quantity stepper capped at what's available
- a "Buy now · ₦X" button.

A paused or deleted product shows the same not-found page a service does. The page has a link
card for WhatsApp and Instagram, built like the service cards (`opengraph-image.tsx`, square
875×875, primed before sending with `primeLinkCard`).

### Checkout: `/products/<slug>/checkout`

The page shows:

- the chosen line
- Delivery or Pickup (only the ones the business offers)
- a delivery address (delivery only)
- name, phone and an optional email
- the delivery fee, the total, and "Pay ₦X".

`POST /api/public/orders` does the following:

1. Validates the request.
2. Checks availability: stock minus active holds.
3. Creates the order as AWAITING_PAYMENT, with `holdExpiresAt` 30 minutes out. It reuses the
   booking hold helper (`holdExpiresFrom`).
4. Starts a Paystack transaction on the business's subaccount for the total, with
   `{ orderId, businessId }` in the metadata.
5. Returns the payment URL.

The Paystack callback returns through `/api/webhooks/paystack?o=<orderSlug>` (bookings use
`?b=`) to a done page. For pickup, the done page shows the pickup address.

If the business has no Paystack subaccount yet, products can't be bought online. The builder
should mirror what service pages do in that case today.

### Payment webhook

`charge.success` with `metadata.orderId` gets its own branch next to the booking branch in
`src/app/api/webhooks/paystack/route.ts`. Like the booking branch, it never drops a payment.

1. Check the amount and the business. Ignore a reference that has already been processed.
2. In one transaction:
   - mark the order NEW and set `paidAt`
   - create the Payment (PAYSTACK, linked to the order)
   - take the stock line by line.

   If the stock is short (a late payment after the hold expired), take what's left and set the
   oversold flag. Stock never goes below zero.
3. Link the customer, or create one.
4. Best effort, after the transaction:
   - create the automatic receipt, listing the products and the delivery fee
   - alert the owner
   - email the customer.

### Stock and holds

- **Available** means stock minus the quantities in AWAITING_PAYMENT orders whose hold hasn't
  expired. An expired hold simply stops counting, so no cron is needed. Cleaning up old holds is
  optional.
- A product with stock tracking off is always available.
- The owner can add stock, remove stock, or set a new count, but never below zero.
- An order keeps the price it was created with, even if the product price changes while the
  customer is paying.

## Orders

| Status | Shown as | Set by |
| --- | --- | --- |
| AWAITING_PAYMENT | (hidden from the main list) | Online checkout started |
| NEW | New | Payment landed: online, or an invoice's first payment |
| READY | "Ready for pickup" or "Out for delivery" | Owner |
| COMPLETED | "Collected" or "Delivered" | Owner. A receipt sale with pickup starts here. |
| CANCELLED | Cancelled | Owner, from New or Ready. Stock goes back. |

- A sale recorded on a receipt starts as COMPLETED. If the owner chose delivery on the receipt,
  it starts as NEW instead.
- When the customer has an email, they get one when the order is confirmed (with the receipt
  link), when it's ready (with the pickup address, or "out for delivery"), when it's completed,
  and when it's cancelled. These are new react-email templates written in the same voice as
  the booking emails.
- The customer's order page, `/orders/<publicId>`, shows status, items, fulfilment and the
  receipt link. It looks like the other customer pages.

## Invoices and receipts with products

- A line can be a service, a product option, or a custom line. The dashboard composer and the
  chat's item picker list products with their options and stock, as well as services.
- **A receipt with product lines is a completed sale.** It creates an order (source RECEIPT),
  takes the stock and records the Payment with the receipt's payment method. If stock is short,
  the owner sees a warning and can go ahead anyway, because the physical stock count may be
  wrong.
- **An invoice with product lines** doesn't take stock when it's sent. At its first payment
  (recorded by the owner or paid online), Sara creates the order (source INVOICE, status NEW,
  fulfilment set by the owner on the order, default pickup) and takes the stock. Voiding an
  invoice that has an order asks the owner whether to cancel the order too.
- The existing editing rules still apply: a paid invoice can't be edited, and a part-paid one
  can only take more payments.

### Paying an invoice online

- The customer invoice page shows "Pay NGN X" for invoices that are Sent, Overdue or Partially
  paid. The button pays the **whole remaining balance**. There's no custom part payment online.
- The button only appears when the business has a Paystack subaccount.
- The Paystack metadata carries `{ invoiceId, businessId }`. Its webhook branch:
  - records the Payment and updates `amountPaid` and the status
  - creates the receipt automatically, as for bookings
  - creates the order if the invoice lists products
  - alerts the owner
  - emails the customer.

## Customers

- **List:** search by name, phone or email, sorted by most recent activity. Each row shows
  name, phone, total spent and amount owed.
- **Customer page:**
  - editable contact details
  - spent (the sum of payments), owes (unpaid invoice balances) and customer since
  - a newest-first timeline of bookings, orders, invoices and receipts
  - quick actions: new invoice, new receipt.
- **Matching** runs wherever Sara saves a record with customer details: public booking,
  checkout, invoice, receipt and payment.
  1. Normalised phone.
  2. Lower-cased email.
  3. Exact name, ignoring case and extra spaces. This only applies when the record has neither
     phone nor email and exactly one customer has that name.

  If a later record adds a phone or email to a name-only customer, Sara fills it in. A
  different phone or email than the one on file creates a new customer rather than overwriting.
- **Merge:** the owner picks two customers. Every record moves to the one they keep, and the
  other is deleted.
- **Composers:** the customer field searches existing customers, and picking one fills in the
  name, phone and email. The chat's "Customer's name?" step links to the existing customer when
  exactly one matches. When several match, it asks with a numbered choice that includes "New
  customer".

## Owner alerts

- For every paid order (online or through an invoice), the owner's linked chats get an alert
  through `ownerNotifier`, for example:
  `🛍️ New order ORD-1022 · Tolu Adeyemi · 2 × Frontal wig 20" · NGN 93,000 · Delivery to 12 Admiralty Way`
- Outside WhatsApp's 24-hour window, free-form messages are rejected. Owner alerts (new order,
  booking paid) therefore go out as an approved WhatsApp utility template whenever the window
  is closed.
  - Registering and approving the template in Meta Business Manager is a manual step. The code
    reads the template name from config.
  - Instagram has no equivalent, so it stays best effort.

## Dashboard

- **Navigation:** Today, Bookings*, Orders†, Invoices, Receipts, Customers, Services*,
  Products†, Settings.
  - \* means service sellers; † means product sellers. A business that does both sees
    everything.
- **Today:**
  - adds "Orders to send out" (New and Ready) and "Running low" (3 or fewer left)
  - "Revenue by service" becomes "Revenue by item" and covers products too
  - the chat's business summary reads the same numbers, through `dashboardService`.
- **Products:**
  - a list with stock badges
  - create and edit: photos, name, description, price, options with stock and optional price,
    and the track-stock switch
  - pause, copy link, adjust stock.
- **Orders:**
  - a list filtered by status
  - an order page with items, customer, fulfilment, address, payment and receipt
  - actions: Mark ready, Mark delivered or collected, Cancel.
- **Customers:** as described above.
- **Settings:** what you sell, delivery fee, pickup.

## Chat menu

- **A business that only sells services** sees today's menu unchanged.
- **A business that sells products:**
  - "3️⃣ Share a service" becomes "Share a link" and lists products as well as services, labelled
    `Frontal wig — NGN 45,000 (11 in stock)`
  - "Orders to send out" is added.
- **A business that does both** sees one combined list, at most 8 items.
- The invoice and receipt item pickers list product options as well as services.

## Onboarding and settings

- Onboarding adds a "What do you sell?" step: Services, Products or Both. Product sellers then
  set delivery and pickup. They can skip that step, but products can't be bought online until
  it's done.
- Existing businesses start as Services and can change this in Settings.

## Edge cases

- A deleted option with orders still pointing at it is deactivated, not removed.
- A quantity above what's available is blocked at checkout with "Only N left".
- Two customers racing for the last item: availability is checked and the hold is created in
  one transaction, so only one wins.
- A Paystack webhook delivered twice is handled once (keyed on the reference), as for bookings.
- Products use the business currency, like services.

## Testing

- **Unit tests:**
  - availability and holds, including expiry and the race for the last item
  - matching rules and merge
  - line migration (documents total the same before and after)
  - receipt and invoice paths into orders.
- **Webhook tests** for the order branch and the invoice branch: duplicate delivery, oversold,
  wrong amount, wrong business.
- **Route tests** in the existing `route.test.ts` style for the public order endpoint and the
  owner product, order and customer endpoints.

## Implementation sequencing

1. Customers: model, matching, backfill, list and page, merge. Also the general invoice and
   receipt lines.
2. Products and options: model, dashboard create and edit, photos, settings (what you sell,
   delivery, pickup), the onboarding step.
3. Product page, checkout, the webhook order branch, the orders dashboard, order emails, and
   owner alerts through the template.
4. Receipts and invoices with products creating orders, and the invoice Pay button.
5. Today page and chat menu changes.
6. `PRODUCT.md` updates. The landing copy for merchants can wait for the copy step in the
   companion spec.

## Owner to-do outside the code

- Create the owner-alert message template in Meta Business Manager (utility category) and get
  it approved. Until then, alerts only reach owners who messaged Sara in the last 24 hours, as
  today.

## Left to the builder

- Table, column and route names; component structure.
- How the availability query is written.
- Email and template wording, within the brand voice. Meta must approve the template.
- The merge UI, the exact layout of new screens within `DESIGN.md`, and how to phase the menu
  changes.

## Mockups

The owner approved these during brainstorming. They're stored locally and not committed:
`.superpowers/brainstorm/1722-1792596598/content/selling-products.html` (product page, checkout,
orders, products, customer page).

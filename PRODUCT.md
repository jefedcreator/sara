# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

- App: Next.js 15 (App Router) + Tailwind CSS v4, design tokens in `src/styles/globals.css`, fonts via `next/font`.
- Landing explorations: static HTML/CSS/JS, one self-contained folder per version (`landing/vN/<skill>/`), not wired into the app.
- Visual language for the whole product: v1 Impeccable (Clean Minimal SaaS), recorded in root `DESIGN.md`.

## Users

Owners of one-person or small Nigerian service businesses: hair stylists, braiders, makeup and gele artists, barbers, photographers, tailors. They run everything from their phone, mostly inside WhatsApp and Instagram DMs, often between clients. They reach the landing page on a phone, usually from a link in an Instagram bio.

Merchants who sell products (wigs and hair, fashion, beauty, cakes and other made-to-order goods) are users too. They sell through the same Instagram and WhatsApp DMs and need a link to send, payment straight to their own account, stock that stays right and a list of what to send out. A business can sell services, products or both.

## Product Purpose

Sara lets the owner run the business from the WhatsApp or Instagram chat they already live in: create invoices and receipts, share a service's booking link, check unpaid invoices, see today's bookings and get a business summary. Everything the chat does is also on the web dashboard, which adds what a chat can't do well: setting up services and hours, and working through lists of bookings and invoices. Customers book and pay in the browser through the booking link. Success for the landing page: the owner taps "Start on WhatsApp".

## Positioning

A guided, deterministic numbered chat menu (not an AI chatbot) on top of serious infrastructure: Paystack split payments into the business's own subaccount, Mono bank linking, two-way Google Calendar sync, automatic receipts and customer emails. A one-person shop gets the back office of a salon chain without ever opening a laptop.

## Operating Context

- Owner chat menu, verbatim, by what the business sells (the Today page numbers its actions the same way). "menu" or "0" goes back.
  - Services only: "Sara 👋 Reply with a number: 1️⃣ New invoice · 2️⃣ New receipt · 3️⃣ Share a service (booking link) · 4️⃣ Unpaid invoices · 5️⃣ Today's bookings · 6️⃣ Business summary".
  - Products only: "Sara 👋 Reply with a number: 1️⃣ New invoice · 2️⃣ New receipt · 3️⃣ Share a link · 4️⃣ Unpaid invoices · 5️⃣ Orders to send out · 6️⃣ Business summary".
  - Both: "Sara 👋 Reply with a number: 1️⃣ New invoice · 2️⃣ New receipt · 3️⃣ Share a link · 4️⃣ Unpaid invoices · 5️⃣ Today's bookings · 6️⃣ Business summary · 7️⃣ Orders to send out".
  - "Share a link" lists products as well as services. Orders to send out reads "1. ORD-1022 · Tolu Adeyemi · Delivery · New".
  - New invoice and New receipt ask "Customer's name?". One customer with exactly that name is linked without asking; customers whose name starts with it are offered as "Which customer? 1. Tolu Adeyemi · +2348035550142 · 2. Tolu Bakare · 3. New customer". The item list includes product options as well as services.
- Customer links: the chat shares a service's page, `app.sara.ng/services/<service-slug>` (e.g. `app.sara.ng/services/tobi-knotless-braids`), whose "Book a time" opens the booking page at `app.sara.ng/book/<service-slug>`, or a product's page, `app.sara.ng/products/<product-slug>`, where the customer checks out. Invoices, receipts, bookings and orders each have a customer page at `/invoices/<id>`, `/receipts/<id>`, `/bookings/<id>` and `/orders/<id>` (random ids). Service labels: "Knotless braids — NGN 25,000 (4 hr)". Product labels: "Frontal wig — NGN 45,000 (11 in stock)".
- Onboarding: message Sara's single WhatsApp number, get a one-time link, sign in with Google, Facebook or Instagram, chat is connected. Onboarding asks "What do you sell?" (Services, Products or Both). Delivery and pickup are set in Settings, and products can't be bought online until the business offers at least one of them. Existing businesses start as Services and can change it in Settings.

## Capabilities and Constraints

- Availability respects weekly working hours, one-off closures, existing bookings and two-way Google Calendar sync (confirmed added, cancellations removed, reschedules moved).
- Paystack split payments settle into the business's subaccount; Mono links the bank account for settlement.
- Invoices: line items (services, product options or custom lines), tax, discount, Unpaid / Partially paid / Paid, PDF export. Receipts created automatically when a payment lands.
- Online invoice payment: the customer's invoice page has a Pay button for the remaining balance, through Paystack into the business's subaccount.
- Products: photos, name, description, price, and options (size, length, colour) that each keep their own stock and can override the price. Stock tracking can be switched off for made-to-order goods ("Made to order"). Stock reads "11 in stock", "3 left" (3 or fewer is running low) or "Sold out".
- Product links and checkout: each product has its own page and link. The customer picks an option, a quantity, and pickup or delivery (an address and one flat delivery fee the owner sets), then pays through Paystack into the business's subaccount. One product per checkout. An unpaid checkout holds its stock for 30 minutes.
- Orders: every paid sale becomes an order numbered ORD-1001, ORD-1002, …: online checkouts, receipts that list products (a walk-in or DM sale; Sara warns when stock looks short and lets the owner go ahead) and invoices that list products, at their first payment. Orders go New → Ready (Ready for pickup or Out for delivery) → Collected or Delivered; cancelling puts the stock back. A payment that lands after its hold expired, when the stock has since sold out, still creates the order, marked Oversold, and the owner is told. The customer gets an email at each step, and the owner's linked chats get an alert for each paid order (an approved WhatsApp template outside WhatsApp's 24-hour window).
- Customer list: every business has one. Sara recognises a returning customer by phone, then email, then exact name when only one customer has it. A customer's page shows what they bought and booked, what they spent and what they owe; the owner can edit details and merge duplicates.
- Customers get confirmation, reschedule and cancellation emails plus a 24-hour reminder, and order emails. Sara never messages customers on WhatsApp; it only replies to the owner.
- Business summary: today's revenue, this week's revenue, unpaid count; revenue per service and product.
- Home service: route and distance between customer and business address.
- Web dashboard (decided by the owner 2026-09-29): a superset of the chat. Today (the chat's menu items for the business, plus revenue by item, orders to send out and running low), Bookings (confirm, mark done, reschedule, cancel), Orders (filter by status; mark ready, delivered or collected; cancel), Invoices (itemised or custom amount, record full or part payments with an optional receipt, void), Receipts, Customers, Services (create, edit, pause, booking links), Products (create, edit, pause, copy link, adjust stock) and Settings (profile, hours, days off, Google Calendar, what you sell, delivery and pickup). Bookings and Services show for businesses that sell services, Orders and Products for those that sell products. The chat and the dashboard read the same numbers (dashboardService).
- Booking modes per service: by time slot (default), by the night (shortlets: check-in/check-out times, min/max nights, priced per night) and by the day (self-drive: 24-hour days from a chosen pickup time, priced per day). Each apartment or car is its own service with its own calendar; stays and rentals never block other units or the owner's slot bookings. Unpaid bookings hold their time for 30 minutes.
- Does NOT exist yet (never claim): caution fees / security deposits, iCal sync with Airbnb or Booking.com, guest count or ID capture, pickup and drop-off locations for rentals, no-show/reliability scores, buffer times, QR codes, customer-side WhatsApp booking, a shop page listing everything a business sells, a shopping cart, discount codes, cost prices and profit reports, delivery company integrations, refunds through Sara. Sara is not AI and must never be described as one.
- Money: "NGN 15,000" in UI chrome, "₦15,000" in headline and stat copy.

## Brand Commitments

- Primary CTA everywhere: "Start on WhatsApp". Optional hero-only secondary: "See how booking links work".
- Calm, warm, confident, at home in Lagos. No Silicon Valley hype, no AI/chatbot language.
- Partner names appear only as plain text or neutral wordmarks in a "Works with" row.
- Colour: the original brief ruled out WhatsApp green; on 2026-09-25 the owner chose WhatsApp green (#25D366) as the accent for the preferred direction (v1 Impeccable).

## Evidence on Hand

- No real photography yet: every hero slot is a reserved flat placeholder until images are supplied.
- Stats are SAMPLE placeholders (confirmed by user 2026-09-25), not real metrics: "₦48.2M collected through Sara booking links", "3,100+ businesses across Lagos, Abuja and Port Harcourt", "Receipts sent in under 5 seconds". Mark them in markup and replace before launch.
- No real testimonials, customer logos or pricing exist. Do not fabricate them as fact.

## Product Principles

1. The chat is the product: every claim is shown as a real exchange, invoice line or number.
2. Deterministic over clever: numbered menus, predictable replies.
3. Serious infrastructure, plain language.
4. Phone first: 375px is the primary canvas.

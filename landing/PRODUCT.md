# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/JS, one self-contained folder per landing version (`landing/vN/<skill>/`). Not wired into the Next.js app. Hosted fonts via Google Fonts / Fontshare links.

## Users

Owners of one-person or small Nigerian service businesses: hair stylists, braiders, makeup and gele artists, barbers, photographers, tailors. They run everything from their phone, mostly inside WhatsApp and Instagram DMs, often between clients. They reach the landing page on a phone, usually from a link in an Instagram bio.

## Product Purpose

Sara lets the owner run the business from the WhatsApp or Instagram chat they already live in: create invoices and receipts, share a service's booking link, check unpaid invoices, see today's bookings and get a business summary. Customers book and pay in the browser through the booking link. Success for the landing page: the owner taps "Start on WhatsApp".

## Positioning

A guided, deterministic numbered chat menu (not an AI chatbot) on top of serious infrastructure: Paystack split payments into the business's own subaccount, Mono bank linking, two-way Google Calendar sync, automatic receipts and customer emails. A one-person shop gets the back office of a salon chain without ever opening a laptop.

## Operating Context

- Owner chat menu, verbatim: "Sara 👋 Reply with a number: 1️⃣ New invoice · 2️⃣ New receipt · 3️⃣ Share a service (booking link) · 4️⃣ Unpaid invoices · 5️⃣ Today's bookings · 6️⃣ Business summary". "menu" or "0" goes back.
- Booking links: `app.sara.ng/book/<service-slug>`, e.g. `app.sara.ng/book/tobi-knotless-braids`. Service labels: "Knotless braids — NGN 25,000 (4 hr)".
- Onboarding: message Sara's single WhatsApp number, get a one-time link, sign in with Google, Facebook or Instagram, chat is connected.

## Capabilities and Constraints

- Availability respects weekly working hours, one-off closures, existing bookings and two-way Google Calendar sync (confirmed added, cancellations removed, reschedules moved).
- Paystack split payments settle into the business's subaccount; Mono links the bank account for settlement.
- Invoices: line items, tax, discount, Unpaid / Partially paid / Paid, PDF export. Receipts created automatically when a payment lands.
- Customers get confirmation, reschedule and cancellation emails plus a 24-hour reminder. Sara never messages customers on WhatsApp; it only replies to the owner.
- Business summary: today's revenue, this week's revenue, unpaid count; revenue per service.
- Home service: route and distance between customer and business address.
- Does NOT exist yet (never claim): deposit-gated bookings, no-show/reliability scores, buffer times, QR codes, customer-side WhatsApp booking, a web dashboard. Sara is not AI and must never be described as one.
- Money: "NGN 15,000" in UI chrome, "₦15,000" in headline and stat copy.

## Brand Commitments

- Primary CTA everywhere: "Start on WhatsApp". Optional hero-only secondary: "See how booking links work".
- Calm, warm, confident, at home in Lagos. No Silicon Valley hype, no AI/chatbot language.
- WhatsApp green is never a brand color; partner names appear only as plain text or neutral wordmarks in a "Works with" row.

## Evidence on Hand

- No real photography yet: every hero slot is a reserved flat placeholder until images are supplied.
- Stats are SAMPLE placeholders (confirmed by user 2026-09-25), not real metrics: "₦48.2M collected through Sara booking links", "3,100+ businesses across Lagos, Abuja and Port Harcourt", "Receipts sent in under 5 seconds". Mark them in markup and replace before launch.
- No real testimonials, customer logos or pricing exist. Do not fabricate them as fact.

## Product Principles

1. The chat is the product: every claim is shown as a real exchange, invoice line or number.
2. Deterministic over clever: numbered menus, predictable replies.
3. Serious infrastructure, plain language.
4. Phone first: 375px is the primary canvas.

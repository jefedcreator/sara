---
name: Sara
description: Run the whole business from the chat you already live in. Calm, proof-first, phone-first.
colors:
  canvas: "#ffffff"
  surface: "#f4f7f5"
  line: "#e5ebe7"
  ink: "#0f1a14"
  ink-2: "#37443c"
  muted: "#5a665f"
  faint: "#7f8a84"
  accent: "#25d366"
  accent-hover: "#1fbf5b"
  accent-ink: "#075e54"
  on-accent: "#0b2b1a"
  accent-soft: "#e8f9ee"
  accent-tint: "#c8f0d6"
  danger: "#b42318"
  danger-soft: "#fef3f2"
  google-blue: "#4285f4"
  google-green: "#34a853"
  google-yellow: "#fbbc05"
  google-red: "#ea4335"
  facebook: "#0866ff"
  instagram-yellow: "#ffd600"
  instagram-orange: "#ff7a00"
  instagram-pink: "#ff0069"
  instagram-purple: "#d300c5"
  instagram-violet: "#7638fa"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Hanken Grotesk, sans-serif"
    fontSize: "clamp(2.6rem, 1.4rem + 5.4vw, 5.1rem)"
    fontWeight: 360
    lineHeight: 1.02
    letterSpacing: "-0.04em"
    fontVariation: "'opsz' 96"
  headline:
    fontFamily: "Bricolage Grotesque, Hanken Grotesk, sans-serif"
    fontSize: "clamp(1.9rem, 1.3rem + 2.2vw, 3rem)"
    fontWeight: 400
    lineHeight: 1.06
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Bricolage Grotesque, Hanken Grotesk, sans-serif"
    fontSize: "19px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  stat:
    fontFamily: "Bricolage Grotesque, Hanken Grotesk, sans-serif"
    fontSize: "clamp(2.4rem, 1.8rem + 2.2vw, 3.4rem)"
    fontWeight: 330
    lineHeight: 1
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "'tnum' 1"
  label:
    fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  chip: "10px"
  bubble: "18px"
  card: "24px"
  panel: "28px"
  shot: "32px"
  pill: "9999px"
spacing:
  gutter-sm: "16px"
  gutter-md: "32px"
  section: "104px"
  section-lg: "140px"
  max: "1160px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    height: "48px"
    padding: "0 8px 0 22px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "48px"
    padding: "0 22px"
  button-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.pill}"
    height: "40px"
    padding: "0 18px"
  bubble-owner:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.bubble}"
    padding: "10px 14px"
  bubble-sara:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.bubble}"
    padding: "10px 14px"
  chip:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.chip}"
    padding: "7px 10px"
  status-pill:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "22px 18px 20px"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.chip}"
    height: "44px"
    padding: "0 14px"
---

# Design System: Sara

<!-- Source of truth for every surface in the product (app and marketing). Established by the owner on 2026-09-25 from landing/v1/impeccable. Tokens above are mirrored in src/styles/globals.css (@theme). Implementation rule: style only with Tailwind utilities on these tokens (bg-accent, text-accent-ink, rounded-panel, shadow-float, animate-rise...); no CSS modules or component stylesheets. Reference implementation: src/app/components/landing/LandingPage.tsx. -->

## Overview

**Creative North Star: "The Chat Is the Proof"**

Sara's interface never describes what Sara does; it shows the reply. Every surface is built from the same material a business owner already trusts: short chat exchanges, invoice lines, booking slots and real naira figures, laid out on pure white with generous air. The page is calm and unhurried, closer to a well-kept ledger than to a SaaS dashboard, and it assumes a phone first: 375px is the primary canvas, desktop is the roomy version of the same thing.

One colour does all the talking. WhatsApp green fills the actions and the owner's own voice (their chat bubbles, selected states, the primary button); everything else is ink, green-tinted greys and white. Type is a light, slightly quirky grotesque for display (Bricolage Grotesque) against a sturdy workhorse sans for UI (Hanken Grotesk), with tabular figures everywhere money appears.

The owner chose this world on 2026-09-25; it replaces the earlier dark zinc and emerald app styling.

**Key Characteristics:**
- Pure white canvas, soft green-grey surfaces, no dark sections.
- One accent: WhatsApp green as fill, deep WhatsApp teal-green for green text.
- Light display type with tight tracking; workhorse sans for everything interactive.
- Pill controls, big soft radii (24-32px) on surfaces.
- Real product content as the illustration: bubbles, invoices, slots, numbers.
- Motion arrives like a message: owner first, reply after.

## Colors

A restrained palette: white, green-tinted neutrals and a single WhatsApp green used with intent.

### Primary
- **WhatsApp Green** (accent): fills only. Primary buttons, owner chat bubbles, menu numerals, selected day and slot, progress fills, the closing wordmark. Always carries dark text (on-accent); never white text (2:1 fails).
- **Pressed Green** (accent-hover): hover state for green fills.
- **Deep Teal-Green** (accent-ink): every piece of green *text* or *line* on a light ground: links in chips, times in agendas, status labels, icons, focus rings, selected outlines (7.8:1 on white).
- **Green Ink** (on-accent): text and icons sitting on a green fill (7.7:1).
- **Mint Wash** (accent-soft): chip and status backgrounds, icon discs, progress tracks.
- **Mint Tint** (accent-tint): text selection, scrollbar thumb, hover underline, light gradient stop.

### Neutral
- **Canvas White** (canvas): page ground, Sara's chat bubbles, cards that sit on surface.
- **Leaf Grey** (surface): card ground, alternate section bands, disabled fills.
- **Hairline** (line): 1px dividers, input and bubble borders.
- **Ink** (ink): headings and body text, dark buttons.
- **Ink Soft** (ink-2): secondary headings, link text.
- **Muted** (muted): body copy under headings, captions, descriptions.
- **Faint** (faint): quiet labels such as "Works with" and struck-through unavailable slots. Large or non-essential text only.

### Status (app extension)
- **Danger** (danger) on **Danger Wash** (danger-soft): errors and destructive confirmations. Used sparingly and never as decoration.

### Brand Marks (sign-in only)
- **Google, Facebook, Instagram** (google-*, facebook, instagram-*): each provider's own logo colours, used only inside that provider's mark on the sign-in buttons. Never for text, fills or anything that is not the logo itself.

### Named Rules
**The Green Fill Rule.** WhatsApp green is a fill, never a text colour on white. If it has to be read, it is Deep Teal-Green.

**The One Voice Rule.** Green belongs to actions and to the owner's own words. If more than roughly a tenth of a screen is green, something that is not an action has been coloured.

## Typography

**Display Font:** Bricolage Grotesque (fallback Hanken Grotesk, sans-serif), optical size 96 for large settings.
**Body Font:** Hanken Grotesk (fallback ui-sans-serif, sans-serif).

**Character:** A light, slightly idiosyncratic grotesque that feels confident without shouting, paired with a clean, sturdy sans that keeps forms, tables and chat readable at small sizes.

### Hierarchy
- **Display** (360, clamp 2.6rem to 5.1rem, 1.02): page heroes only. Tracking -0.04em, balanced wrapping.
- **Headline** (400, clamp 1.9rem to 3rem, 1.06): section and screen titles, max about 22ch.
- **Title** (500, 19-22px, 1.2): card titles, invoice customer names, FAQ questions.
- **Stat** (330, clamp 2.4rem to 3.4rem, 1): headline figures; light weight keeps big numbers calm.
- **Body** (400, 16px, 1.6): running text, max 50-60ch, colour muted under a heading.
- **Label** (600, 13-15px): buttons, chips, table headers, status pills. Sentence case, no tracking, no uppercase.

### Named Rules
**The No-Eyebrow Rule.** No small uppercase tracked labels above headings. The heading carries its own weight.

**The Tabular Money Rule.** Every naira figure uses tabular numerals and the "NGN 15,000" form in UI; "₦15,000" is reserved for marketing headlines and stats.

## Layout

Single column first. Content lives in a centred container (max 1160px) with a 16px gutter on phones and 32px from 768px. Sections breathe: about 104px vertical padding, 140px for statement moments, with more space above a heading than below it. Two-column splits (copy plus proof) appear from 960px; card grids go 1, 2, then 3 columns (700px, 1040px) with a staggered middle column on desktop. Sticky headings may hold the left column while a list scrolls on the right. Navigation is a 64px sticky bar that gains a hairline once the page scrolls.

## Elevation & Depth

Mostly flat with tonal layering: white cards on leaf-grey surfaces and leaf-grey cards on white. Shadows are reserved for things that float above the page (product screenshots, the booking page, invoices, notification bubbles) and are always tinted green-ink, never black.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 28px 60px -28px rgb(7 94 84 / .34), 0 2px 8px -2px rgb(15 26 20 / .08)`): hero screenshots, booking page, anything presented as "the product".
- **Card** (`box-shadow: 0 28px 60px -34px rgb(15 26 20 / .24)`): documents such as invoices.
- **Lift** (`box-shadow: 0 18px 40px -18px rgb(15 26 20 / .28)`): overlapping notification bubbles.
- **CTA** (`box-shadow: 0 10px 24px -12px rgb(7 94 84 / .55)`): large primary buttons only.
- **Hairline bubble** (`box-shadow: 0 1px 2px rgb(15 26 20 / .04)`): Sara's white chat bubbles.

### Named Rules
**The Tinted Shadow Rule.** No neutral black shadows. Depth is always tinted toward the palette.

## Shapes

Soft and friendly. Every interactive control is a full pill (buttons, slot choices, copy fields, link boxes). Surfaces use large radii: cards 24px, panels and feature cards 28px, hero screenshots 32px. Chat bubbles are 18px with one 6px "tail" corner toward the speaker (bottom-left for Sara, bottom-right for the owner). Chips and inputs sit at 10px. Borders are 1px hairlines; dashed borders only mark closed or unavailable days.

## Components

### Buttons
- **Shape:** full pill (9999px).
- **Primary:** WhatsApp green fill, green-ink text, 48px tall (56px large), with a white arrow disc on the right (40px, deep teal arrow). One primary per view.
- **Hover / Focus:** fill shifts to pressed green, arrow nudges 2px right; focus is a 2px deep teal outline, 3px offset. Active scales to 0.98.
- **Secondary:** white with hairline border, ink text; border turns ink on hover.
- **Dark:** ink fill, white text; used for compact utility actions (nav CTA on dense bars, copy buttons). Hover moves to deep teal.
- **Disabled:** leaf-grey fill, faint text, not-allowed cursor, never green.

### Chips and Status Pills
- **Style:** mint wash background, deep teal text, 600 weight, 10px radius (chips) or pill (status).
- **State:** status text is literal product language: Unpaid, Partially paid, Paid.

### Cards / Containers
- **Corner Style:** 28px for feature cards, 24px for documents.
- **Background:** leaf grey on white sections; white when the section itself is leaf grey.
- **Shadow Strategy:** flat unless the card represents product output (see Elevation).
- **Border:** hairline only on white-on-white documents.
- **Internal Padding:** 18-26px.

### Inputs / Fields
- **Style:** white field, hairline border, 10px radius, 44px tall, ink text, muted placeholder.
- **Focus:** border becomes deep teal plus a 3px mint-tint ring.
- **Error / Disabled:** danger border with danger text below the field; disabled uses leaf-grey fill and faint text.
- Labels sit above the field in label style; never placeholder-as-label.

### Navigation
Sticky white bar, translucent with blur, 64px; wordmark "sara" in display 600 at 26px on the left, muted 15px links centred, compact primary on the right. Links darken to ink on hover. Below 960px the links collapse into a round leaf-grey menu button that opens a full-width list.

### Logo
One mark, **Handoff**: an "s" in two halves. The top half is the owner's business, in ink; the bottom half is the admin Sara takes off their hands, in WhatsApp green (a fill, never text). Each half is round on its outer end and nearly square (3 on a 100 grid) on its inner one; rounding the inner corners to match turns the "s" into two stacked pills, so keep them near-square. The geometry lives once, in `src/utils/brand.ts`, and every surface draws from it.

- **Lockup** (`Wordmark`): the mark at 0.95em beside "sara" in display 600 (-0.04em, opsz 48), 0.28em apart, the mark centred on the x-height. The name stays live text. Used in every header (landing nav and footer, app chrome, setup, sign-in, errors).
- **Single ink** (`accent={false}`): quiet credits take the text colour for the whole mark: "Bookings by sara" on the booking page and its share card, "Made with sara" in the invoice and receipt PDF footers, and the all-green closing wordmark on the landing page.
- **Tile** (`LogoTile`): the mark inset to 70% on a 22-radius ink tile, Sara's half still green. This is the favicon, Apple touch icon and app-manifest icon. On a green tile the whole mark is on-accent.
- **Share cards**: the site card (`app/opengraph-image.tsx`) and one per booking link (`app/book/[slug]/opengraph-image.tsx`), built from `src/server/og.tsx` with the app's own fonts from `assets/fonts`.
- **Static files**: `public/brand` (mark, tiles, outlined lockups, specimen) and the favicons come from `yarn brand:generate`, never by hand.

Rejected on the way here, not to be re-proposed: any chat bubble (Sara is an admin assistant, not a messaging brand), a six-petal burst or four-point star (reads as an AI sparkle), an "s" of beads, a receipt bubble (a ghost), a concierge bell (a food cloche), stacked list rows (a list icon), and the cradle and clover alternates.

### Chat Bubbles (signature)
Sara's replies: white, hairline border, 18px radius with a 6px bottom-left corner. Owner messages: WhatsApp green with green-ink text and a 6px bottom-right corner, right-aligned. Numbers in a menu render as green circular numerals (32px). This is the system's illustration language; use it wherever the product's behaviour needs explaining.

### Booking Slots
Day chips and time pills in a grid: available = white with hairline, selected = green fill (days) or mint wash with deep teal outline (times), taken = leaf grey with struck-through faint text, closed = dashed border.

## Do's and Don'ts

### Do:
- **Do** use WhatsApp green (#25d366) only as a fill with green-ink (#0b2b1a) text on it.
- **Do** use deep teal-green (#075e54) for any green text, icon or outline on white.
- **Do** show the product's real output (a reply, an invoice line, a slot grid) instead of an icon or illustration.
- **Do** keep controls as full pills and surfaces at 24-32px radii.
- **Do** tint every shadow toward the palette.
- **Do** design at 375px first and let desktop add space, not content.
- **Do** honour `prefers-reduced-motion`; entrance motion is a message arriving (owner first, reply 140ms later), nothing more.

### Don't:
- **Don't** put white text on WhatsApp green.
- **Don't** reintroduce dark zinc sections or emerald accents from the old app styling.
- **Don't** add a second accent colour or gradients beyond a two-stop tint of mint.
- **Don't** use small uppercase tracked eyebrow labels above headings.
- **Don't** build icon-grid feature rows without a real exchange, number or document inside.
- **Don't** describe Sara as AI or a chatbot anywhere in the UI.

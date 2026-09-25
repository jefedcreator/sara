# Sara v1 · Impeccable · Clean Minimal SaaS

Documented from the built page (`index.html`, `style.css`).

## World
Proof over promise. Pure white ground; the chat itself is the design material. No icon tiles, no illustration.

## Colour
Owner decision (2026-09-25): the accent is WhatsApp green, replacing adire indigo.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#ffffff` | Page ground (brief-pinned pure white) |
| `--ink` | `#0f1a14` | Text, green-tinted near-black |
| `--muted` / `--faint` | `#5a665f` / `#7f8a84` | Secondary text |
| `--line` | `#e5ebe7` | Hairlines |
| `--soft` | `#f4f7f5` | Card and band ground |
| `--accent` | `#25d366` | WhatsApp green. Fills only: CTAs, owner bubbles, numerals, selected days/slots, progress |
| `--accent-hover` | `#1fbf5b` | Button hover |
| `--on-accent` | `#0b2b1a` | Text on green fills (7.7:1). Never white on green (2:1 fails) |
| `--accent-ink` | `#075e54` | Any green text, icons, focus rings and outlines on light grounds (7.8:1) |
| `--accent-soft` / `--accent-tint` | `#e8f9ee` / `#c8f0d6` | Chips, icon discs, hero placeholder gradient |

Shadows are green-tinted (`rgb(7 94 84 / .34)`), never black.

## Type
- Display: **Bricolage Grotesque** 330–600, opsz 96, tracking −0.03 to −0.04em. Light weights for headline and stats.
- UI: **Hanken Grotesk** 400–700. Tabular figures page-wide.

## Shape
Pill for every control; cards 24–28px; chat bubbles 18px with a 6px tail corner.

## Components
Chat bubble (`.msg.in` white/bordered, `.msg.out` green with dark text), free-time rules list (icon disc + heading + line, sticky heading on desktop; ported from v2 Taste), numbered menu card, booking page mock (day chips, slot pills, taken = struck through), invoice with partial-payment bar, copy-link field.

## Motion
One grammar: messages arrive. Owner bubble first, Sara's reply 140ms later, on scroll-in. Hero screenshots rise once on load. All gated by `prefers-reduced-motion`.

## Hero slots
`.shot-tall` 9:19 WhatsApp screenshot; `.shot-summary` 5:4 Business summary card overlapping lower right.

# Sara v1 · Impeccable · Clean Minimal SaaS

Documented from the built page (`index.html`, `style.css`).

## World
Proof over promise. Pure white ground; the chat itself is the design material. No icon tiles, no illustration.

## Colour
| Token | Value | Role |
|---|---|---|
| `--bg` | `#ffffff` | Page ground (brief-pinned pure white) |
| `--ink` | `#0e1233` | Text, indigo-tinted near-black |
| `--muted` | `#5d627c` | Secondary text |
| `--line` | `#e8e9f1` | Hairlines |
| `--soft` | `#f5f6fb` | Card and band ground |
| `--accent` | `#2a3bc4` | Adire indigo: CTA, owner messages, numerals, selected states |
| `--accent-soft` / `--accent-tint` | `#eceefb` / `#dde1f8` | Chips, hero placeholder gradient |

One accent only. Shadows are indigo-tinted (`rgb(42 59 196 / .38)`), never black.

## Type
- Display: **Bricolage Grotesque** 330–600, opsz 96, tracking −0.03 to −0.04em. Light weights for headline and stats.
- UI: **Hanken Grotesk** 400–700. Tabular figures page-wide.

## Shape
Pill for every control; cards 24–28px; chat bubbles 18px with a 6px tail corner.

## Components
Chat bubble (`.msg.in` white/bordered, `.msg.out` indigo), numbered menu card, booking page mock (day chips, slot pills, taken = struck through), invoice with partial-payment bar, copy-link field.

## Motion
One grammar: messages arrive. Owner bubble first, Sara's reply 140ms later, on scroll-in. Hero screenshots rise once on load. All gated by `prefers-reduced-motion`.

## Hero slots
`.shot-tall` 9:19 WhatsApp screenshot; `.shot-summary` 5:4 Business summary card overlapping lower right.

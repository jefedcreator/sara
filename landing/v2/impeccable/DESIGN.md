# Sara v2 · Impeccable · Halftone Print-Tech

Documented from the built page.

## World
A printed ledger run by a terminal. Every claim is a line item, a timestamp or a slot state.

## Colour (strict duotone)
| Token | Value | Role |
|---|---|---|
| `--red` | `#d92d14` | Riso red: halftone dots, selected key, stamp, final chain cell |
| `--ink` | `#0d0d0d` | Text, rules, black pills, terminal screens |
| `--paper` | `#ffffff` | Ground |
Greys exist only as ink at opacity (`.7 .58 .12 .06`). No third hue. `#ff7a63` is red lifted for legibility on ink screens only.

## Type
- Display: **Archivo** variable, width 105–125%, weight 750–900, tracking −0.02 to −0.035em.
- Data: **Martian Mono** 400–600 for IDs, timestamps, labels and figures.

## Shape
Square cells and 1px ink rules everywhere; pills only for CTAs (black with red arrow disc) and offered start times.

## Signature interaction
The console: keys 1–6 (and 0 for the menu) answer with the same reply every time, with a press impression on the matching row and a typed reveal of the reply.

## Texture
Halftone = `radial-gradient` dot at 7px pitch, clouded with radial `mask-image`. Used around the hero, behind the day sheet and in the closing band.

## Hero slot
`.hero-panel` 6:5, bleeds off the right edge on desktop, 4:3 full-bleed on mobile.

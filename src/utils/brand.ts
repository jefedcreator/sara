/**
 * The Sara mark as data: one source for every surface that draws it. The
 * `Logo` primitive renders it in React, the PDF service draws it with pdf-lib,
 * the Open Graph cards render it through next/og, and
 * scripts/gen-brand-assets.mjs exports it to public/ (asserting its copy of
 * these paths still matches this file).
 *
 * The mark is "handoff": an `s` in two halves on a 100-unit grid. The top half
 * is the owner's business, in ink; the bottom half is the admin Sara takes off
 * their hands, in WhatsApp green (a fill, never text). Each half is round
 * (17.5) on its outer end and nearly square (3) on its inner one; rounding the
 * inner corners to match turns the `s` into two stacked pills.
 */
export const MARK_VIEWBOX = 100;

/** The owner's half, drawn in the body colour. */
export const MARK_BODY =
  "M29.5 12H85A3 3 0 0 1 88 15V44A3 3 0 0 1 85 47H29.5A17.5 17.5 0 0 1 29.5 12Z";

/** Sara's half, drawn in accent. */
export const MARK_ACCENT =
  "M15 53H70.5A17.5 17.5 0 0 1 70.5 88H15A3 3 0 0 1 12 85V56A3 3 0 0 1 15 53Z";

/** DESIGN.md tokens the mark and its tiles use, for surfaces with no stylesheet. */
export const BRAND_COLOR = {
  ink: "#0f1a14",
  canvas: "#ffffff",
  accent: "#25d366",
  onAccent: "#0b2b1a",
} as const;

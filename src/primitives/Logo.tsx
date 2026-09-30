import { cn } from "@/utils/cn";

/**
 * The Sara marks.
 *
 * Sara is a software assistant for small service businesses: it takes the
 * administrative weight (invoices, receipts, bookings, payments, the day's
 * numbers) off the owner so the owner can do the work itself. The marks say
 * that, not where Sara happens to be reached. Each is two parts, the owner's
 * business in ink and Sara's help in the one green, drawn heavy and soft to sit
 * beside Bricolage the way the reference marks sit beside their names.
 *
 * - `handoff`  an `s` in two halves: the owner's half on top, the half Sara
 *              takes off their hands below, in green. Admin handed over, the
 *              business whole. **Default.**
 * - `cradle`   an arm that holds a green disc up: support, the business carried.
 *              The friendliest of the three; reads as a helper.
 * - `clover`   four petals for the four jobs (bookings, invoices, receipts,
 *              payments) round an open centre, the green one handled. Set on
 *              the diagonal so it never reads as an AI sparkle.
 *
 * All three were proofed from 16px up (`yarn brand:generate` writes the sheet
 * to public/brand/sara-specimen.png). Rejected, not to be re-proposed: any chat
 * bubble (Sara is not a messaging brand), a six-petal burst (AI sparkle), an
 * `s` of beads, a receipt bubble (reads as a ghost), a concierge bell (reads
 * as a food cloche), stacked list rows (a list icon), and a fully rounded
 * `handoff`, which stops being an `s` and becomes two pills.
 *
 * Path data here is the source of truth; scripts/gen-brand-assets.mjs restates
 * it and asserts every path still appears in this file.
 */

export type MarkName = "handoff" | "cradle" | "clover";

type MarkProps = {
  name?: MarkName;
  /**
   * Fill Sara's part green. Turn it off for single-ink uses (a stamp, print)
   * and on a green ground, where it would vanish.
   */
  accent?: boolean;
  className?: string;
};

/**
 * The mark alone, sized in `em` so it tracks the font-size it sits in. The
 * body draws in `currentColor`, so `text-ink` on white and `text-canvas` on
 * ink both work without variants.
 */
export function LogoMark({
  name = "handoff",
  accent = true,
  className,
}: MarkProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      // Decorative beside the wordmark; a bare mark is labelled by `Logo`.
      aria-hidden="true"
      focusable="false"
      className={cn("size-[1.1em] shrink-0", className)}
    >
      <Glyph name={name} accent={accent} />
    </svg>
  );
}

function Glyph({ name, accent }: { name: MarkName; accent: boolean }) {
  if (name === "cradle") return <Cradle accent={accent} />;
  if (name === "clover") return <Clover accent={accent} />;
  return <Handoff accent={accent} />;
}

/**
 * Two 76 x 35 halves, 6 apart, each round (17.5) on its outer end and nearly
 * square (3) on its inner one. The near-square corners are what make it an
 * `s`: rounded to match, the halves read as two stacked pills.
 */
function Handoff({ accent }: { accent: boolean }) {
  return (
    <g>
      <path
        d="M29.5 12H85A3 3 0 0 1 88 15V44A3 3 0 0 1 85 47H29.5A17.5 17.5 0 0 1 29.5 12Z"
        fill="currentColor"
      />
      <Shape
        d="M15 53H70.5A17.5 17.5 0 0 1 70.5 88H15A3 3 0 0 1 12 85V56A3 3 0 0 1 15 53Z"
        accent={accent}
      />
    </g>
  );
}

/**
 * A 35-radius half-ring in a 15-unit round-capped stroke, holding a
 * 17-radius disc clear of it by 11: held, never touching.
 */
function Cradle({ accent }: { accent: boolean }) {
  return (
    <g>
      <path
        d="M15 40A35 35 0 0 0 85 40"
        fill="none"
        stroke="currentColor"
        strokeWidth={15}
        strokeLinecap="round"
      />
      <Shape d="M33 34A17 17 0 1 0 67 34A17 17 0 1 0 33 34Z" accent={accent} />
    </g>
  );
}

/**
 * Four teardrop petals struck from radius 6, tips 14-radius bulbs at radius
 * 33, on the diagonals. The green petal points up-right.
 */
function Clover({ accent }: { accent: boolean }) {
  return (
    <g fill="currentColor">
      <path d="M54.24 54.24L76.67 59.74A14 14 0 1 1 59.74 76.67Z" />
      <path d="M45.76 54.24L40.26 76.67A14 14 0 1 1 23.33 59.74Z" />
      <path d="M45.76 45.76L23.33 40.26A14 14 0 1 1 40.26 23.33Z" />
      <Shape
        d="M54.24 45.76L59.74 23.33A14 14 0 1 1 76.67 40.26Z"
        accent={accent}
      />
    </g>
  );
}

/**
 * Sara's part: `fill-accent` when accented, `currentColor` when not. A
 * component rather than a ternary so the accented case emits no `fill`
 * attribute for the utility to fight with.
 */
function Shape({ d, accent }: { d: string; accent: boolean }) {
  if (accent) return <path d={d} className="fill-accent" />;
  return <path d={d} fill="currentColor" />;
}

/**
 * The mark in a filled tile: favicon, app icon, avatar. `ink` (the default and
 * the favicon) keeps Sara's part green; green on ink is a fill on a dark
 * ground, not text. `accent` draws the whole mark in on-accent.
 */
export function LogoTile({
  name = "handoff",
  ground = "ink",
  className,
}: {
  name?: MarkName;
  ground?: "ink" | "accent";
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label="Sara"
      className={cn("size-[1.1em] shrink-0", className)}
    >
      <rect
        width="100"
        height="100"
        rx="22"
        className={ground === "accent" ? "fill-accent" : "fill-ink"}
      />
      <g
        className={ground === "accent" ? "text-on-accent" : "text-canvas"}
        transform="translate(50 50) scale(0.7) translate(-50 -50)"
      >
        <Glyph name={name} accent={ground === "ink"} />
      </g>
    </svg>
  );
}

/** A bare mark that carries the name, for places with no wordmark beside it. */
export function Logo({
  name = "handoff",
  accent = true,
  className,
}: MarkProps) {
  return (
    <span role="img" aria-label="Sara" className={cn("inline-flex", className)}>
      <LogoMark name={name} accent={accent} />
    </span>
  );
}

import { cn } from "@/utils/cn";

/**
 * The Sara marks.
 *
 * Drawn from the product's own illustration language (DESIGN.md "Chat Bubbles"):
 * Sara's material is a short exchange, so the marks are made of it rather than
 * of a generic symbol. Three marks, one family, all soft-cornered like every
 * pill and bubble in the system:
 *
 * - `duet`  two chat bubbles, the owner's (green, tail bottom-right) and
 *           Sara's reply (ink, tail bottom-left), in the order the landing
 *           animates them: owner first, reply after. **Recommended.**
 * - `menu`  six petals round an open centre, one per item in the numbered
 *           chat menu; the green one is the number the owner replies with.
 * - `loop`  a lowercase `s` in one stroke, with a green dot trailing the
 *           terminal like the next message arriving.
 *
 * All three were proofed from 16px up (`yarn brand:generate` writes the sheet
 * to public/brand/sara-specimen.png). `menu` holds at 16px but reads closest
 * to the six-point "sparkle" AI products use, and Sara must never read as AI,
 * so it is an alternate rather than the default.
 *
 * Path data here is the source of truth; scripts/gen-brand-assets.mjs restates
 * it for the static exports and asserts every path still appears in this file.
 */

export type MarkName = "duet" | "menu" | "loop";

type MarkProps = {
  name?: MarkName;
  /**
   * Fill the accent shape WhatsApp green. Turn it off for single-ink uses (a
   * stamp, print) and on a green ground, where it would vanish.
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
  name = "duet",
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
  if (name === "menu") return <Menu accent={accent} />;
  if (name === "loop") return <Loop accent={accent} />;
  return <Duet accent={accent} />;
}

/**
 * 62 x 34 bubbles with the system's 17 : 5 radius ratio (18px bubble, 6px
 * tail corner). The owner's bubble sits top-right and carries the green, as
 * the owner's bubbles do in the product; Sara's reply sits below-left in ink.
 */
function Duet({ accent }: { accent: boolean }) {
  return (
    <g>
      <Shape
        d="M47 12H75A17 17 0 0 1 92 29V41A5 5 0 0 1 87 46H47A17 17 0 0 1 30 29V29A17 17 0 0 1 47 12Z"
        accent={accent}
      />
      <path
        d="M25 54H53A17 17 0 0 1 70 71V71A17 17 0 0 1 53 88H13A5 5 0 0 1 8 83V71A17 17 0 0 1 25 54Z"
        fill="currentColor"
      />
    </g>
  );
}

/**
 * Six teardrop petals struck from radius 10, never the centre: the open core
 * keeps the mark from flooding into a blob at 16px. Tips are 10.5-radius bulbs
 * at radius 36. The accent petal points up-right, toward the reply.
 */
function Menu({ accent }: { accent: boolean }) {
  return (
    <g fill="currentColor">
      <path d="M50 40L40.39 18.24A10.5 10.5 0 1 1 59.61 18.24Z" />
      <Shape
        d="M58.66 45L72.7 25.8A10.5 10.5 0 1 1 82.31 42.44Z"
        accent={accent}
      />
      <path d="M58.66 55L82.31 57.56A10.5 10.5 0 1 1 72.7 74.2Z" />
      <path d="M50 60L59.61 81.76A10.5 10.5 0 1 1 40.39 81.76Z" />
      <path d="M41.34 55L27.3 74.2A10.5 10.5 0 1 1 17.69 57.56Z" />
      <path d="M41.34 45L17.69 42.44A10.5 10.5 0 1 1 27.3 25.8Z" />
    </g>
  );
}

/** Two 18.5-radius bowls in a 15-unit round-capped stroke, and the dot after. */
function Loop({ accent }: { accent: boolean }) {
  return (
    <g>
      <path
        d="M67.5 27A18.5 18.5 0 1 0 50 50A18.5 18.5 0 0 1 40.75 84.02"
        fill="none"
        stroke="currentColor"
        strokeWidth={15}
        strokeLinecap="round"
      />
      <Shape d="M19 70A8 8 0 1 0 35 70A8 8 0 1 0 19 70Z" accent={accent} />
    </g>
  );
}

/**
 * The accent shape: `fill-accent` when accented, `currentColor` when not. A
 * component rather than a ternary so the accented case emits no `fill`
 * attribute for the utility to fight with.
 */
function Shape({ d, accent }: { d: string; accent: boolean }) {
  if (accent) return <path d={d} className="fill-accent" />;
  return <path d={d} fill="currentColor" />;
}

/**
 * The mark in a filled tile: favicon, app icon, avatar. `ink` (the default and
 * the favicon) keeps the green bubble; green on ink is a fill on a dark
 * ground, not text, and it keeps the tab icon from passing for WhatsApp's own.
 * `accent` draws the whole mark in on-accent on a green tile.
 */
export function LogoTile({
  name = "duet",
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
export function Logo({ name = "duet", accent = true, className }: MarkProps) {
  return (
    <span role="img" aria-label="Sara" className={cn("inline-flex", className)}>
      <LogoMark name={name} accent={accent} />
    </span>
  );
}

import { cn } from "@/utils/cn";

/**
 * The Sara marks.
 *
 * Sara sells one idea: the back office of a salon chain, run from the chat the
 * owner already has open. "Reply with a number. Sara does the rest." Both marks
 * are drawn from that exchange, in the product's own bubble language (18 : 6
 * radii, tail corners) and its colour rule: green belongs to the owner's own
 * voice, ink to Sara.
 *
 * - `reply`   Sara's bubble (ink, tail bottom-left) with the owner's green
 *             reply, the numeral disc from the menu, landing on its corner.
 *             One chat, a number in, the business answered. **Default.**
 * - `thread`  the exchange written out: Sara's menu in two lines, the owner's
 *             green reply below on the right. For wide, quiet places where the
 *             conversation should read as a conversation.
 *
 * Both were proofed from 16px up (`yarn brand:generate` writes the sheet to
 * public/brand/sara-specimen.png). Rejected on that sheet, so not re-proposed:
 * two stacked bubbles (reads as any messaging app, says nothing of the
 * business), a six-petal menu burst (reads as an AI sparkle, and Sara is never
 * AI), an `s` strung from menu beads (the letter vanishes into a molecule), and
 * a torn-receipt bubble (reads as a ghost).
 *
 * `reply`'s notch is cut into the path itself rather than masked, so the mark
 * needs no ids and survives export to anything that reads bare SVG. Path data
 * here is the source of truth; scripts/gen-brand-assets.mjs restates it and
 * asserts every path still appears in this file.
 */

export type MarkName = "reply" | "thread";

type MarkProps = {
  name?: MarkName;
  /**
   * Fill the owner's shape WhatsApp green. Turn it off for single-ink uses (a
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
  name = "reply",
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
  if (name === "thread") return <Thread accent={accent} />;
  return <Reply accent={accent} />;
}

/**
 * An 84 x 66 bubble, 28 radius with a 5 tail corner (the system's bubble ratio
 * at mark scale), notched by a 22-radius moat round the 15-radius disc at
 * (73, 30). The moat is 7 units, wide enough to stay open at 16px, so the two
 * voices never touch.
 */
function Reply({ accent }: { accent: boolean }) {
  return (
    <g>
      <path
        d="M34 22H52.51A22 22 0 0 0 89.47 44.58A28 28 0 0 1 90 50V60A28 28 0 0 1 62 88H11A5 5 0 0 1 6 83V50A28 28 0 0 1 34 22Z"
        fill="currentColor"
      />
      <Shape d="M58 30A15 15 0 1 0 88 30A15 15 0 1 0 58 30Z" accent={accent} />
    </g>
  );
}

/**
 * Three 20-unit rows, 6 apart: Sara's two lines left-aligned, the last with
 * Sara's tail corner; the owner's reply right-aligned with the owner's.
 */
function Thread({ accent }: { accent: boolean }) {
  return (
    <g>
      <path
        d="M18 14H82A10 10 0 0 1 82 34H18A10 10 0 0 1 18 14Z"
        fill="currentColor"
      />
      <path
        d="M18 40H54A10 10 0 0 1 64 50V50A10 10 0 0 1 54 60H12A4 4 0 0 1 8 56V50A10 10 0 0 1 18 40Z"
        fill="currentColor"
      />
      <Shape
        d="M46 66H82A10 10 0 0 1 92 76V82A4 4 0 0 1 88 86H46A10 10 0 0 1 36 76V76A10 10 0 0 1 46 66Z"
        accent={accent}
      />
    </g>
  );
}

/**
 * The owner's shape: `fill-accent` when accented, `currentColor` when not. A
 * component rather than a ternary so the accented case emits no `fill`
 * attribute for the utility to fight with.
 */
function Shape({ d, accent }: { d: string; accent: boolean }) {
  if (accent) return <path d={d} className="fill-accent" />;
  return <path d={d} fill="currentColor" />;
}

/**
 * The mark in a filled tile: favicon, app icon, avatar. `ink` (the default and
 * the favicon) keeps the green reply; green on ink is a fill on a dark ground,
 * not text, and it keeps the tab icon from passing for WhatsApp's own green
 * tile. `accent` draws the whole mark in on-accent.
 */
export function LogoTile({
  name = "reply",
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
export function Logo({ name = "reply", accent = true, className }: MarkProps) {
  return (
    <span role="img" aria-label="Sara" className={cn("inline-flex", className)}>
      <LogoMark name={name} accent={accent} />
    </span>
  );
}

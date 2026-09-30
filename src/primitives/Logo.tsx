import { MARK_ACCENT, MARK_BODY } from "@/utils/brand";
import { cn } from "@/utils/cn";

/**
 * The Sara mark, "handoff": an `s` in two halves, the owner's business in ink
 * and the admin Sara takes off their hands in green. Geometry lives in
 * `@/utils/brand`, shared with the PDFs, the Open Graph cards and the static
 * exports (`yarn brand:generate`).
 */

type MarkProps = {
  /**
   * Fill Sara's half green. Turn it off for single-ink uses (a stamp, a quiet
   * credit, the green closing wordmark) and on a green ground.
   */
  accent?: boolean;
  className?: string;
};

/**
 * The mark alone, sized in `em` so it tracks the font-size it sits in. The
 * body draws in `currentColor`, so `text-ink` on white and `text-canvas` on
 * ink both work without variants.
 */
export function LogoMark({ accent = true, className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      // Decorative beside the wordmark; a bare mark is labelled by `Logo`.
      aria-hidden="true"
      focusable="false"
      className={cn("size-[1.1em] shrink-0", className)}
    >
      <Glyph accent={accent} />
    </svg>
  );
}

function Glyph({ accent }: { accent: boolean }) {
  return (
    <g>
      <path d={MARK_BODY} fill="currentColor" />
      {/* No `fill` attribute when accented, so the utility has nothing to fight. */}
      {accent ? (
        <path d={MARK_ACCENT} className="fill-accent" />
      ) : (
        <path d={MARK_ACCENT} fill="currentColor" />
      )}
    </g>
  );
}

/**
 * The mark in a filled tile: favicon, app icon, avatar. `ink` (the default and
 * the favicon) keeps Sara's half green; green on ink is a fill on a dark
 * ground, not text. `accent` draws the whole mark in on-accent.
 */
export function LogoTile({
  ground = "ink",
  className,
}: {
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
        <Glyph accent={ground === "ink"} />
      </g>
    </svg>
  );
}

/** A bare mark that carries the name, for places with no wordmark beside it. */
export function Logo({ accent = true, className }: MarkProps) {
  return (
    <span role="img" aria-label="Sara" className={cn("inline-flex", className)}>
      <LogoMark accent={accent} />
    </span>
  );
}

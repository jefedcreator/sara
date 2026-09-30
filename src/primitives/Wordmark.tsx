import Link from "next/link";

import { cn } from "@/utils/cn";

import { LogoMark } from "./Logo";

/**
 * The Sara lockup: the handoff mark and "sara" in display 600, as in the
 * landing nav. The name stays live text (Bricolage is already loaded), so it
 * is selectable and the lockup scales with one font-size utility.
 * `accent={false}` draws the mark in the text colour, for quiet credits such
 * as "Bookings by sara".
 */
export function Wordmark({
  href = "/",
  accent = true,
  className,
}: {
  href?: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label="Sara home"
      className={cn(
        "font-display text-ink inline-flex items-center gap-[0.28em] text-[26px] leading-none font-semibold tracking-[-0.04em] no-underline [font-variation-settings:'opsz'_48]",
        className,
      )}
    >
      {/* Sized so the drawn mark stands at ascender height, and nudged to centre on the x-height: lowercase "sara" sits ~0.07em below the line box's middle. */}
      <LogoMark
        accent={accent}
        className="size-[0.95em] translate-y-[0.07em]"
      />
      sara
    </Link>
  );
}

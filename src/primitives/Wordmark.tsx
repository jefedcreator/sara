import Link from "next/link";

import { cn } from "@/utils/cn";

import { LogoMark, type MarkName } from "./Logo";

/**
 * The Sara lockup: the mark and "sara" in display 600, as in the landing nav.
 * The name stays live text (Bricolage is already loaded), so it is selectable
 * and the lockup scales with one font-size utility. `mark={false}` gives the
 * bare name for inline credits such as "Bookings by sara".
 */
export function Wordmark({
  href = "/",
  mark = true,
  name = "reply",
  className,
}: {
  href?: string;
  mark?: boolean;
  name?: MarkName;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label="Sara home"
      className={cn(
        "font-display text-ink inline-flex items-center gap-[0.3em] text-[26px] leading-none font-semibold tracking-[-0.04em] no-underline [font-variation-settings:'opsz'_48]",
        className,
      )}
    >
      {/* Nudged to centre on the x-height: lowercase "sara" sits ~0.07em below the line box's middle. */}
      {mark ? <LogoMark name={name} className="translate-y-[0.07em]" /> : null}
      sara
    </Link>
  );
}

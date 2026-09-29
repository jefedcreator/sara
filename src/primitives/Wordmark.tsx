import Link from "next/link";

import { cn } from "@/utils/cn";

/** "sara" in display 600, as in the landing nav. */
export function Wordmark({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-label="Sara home"
      className={cn(
        "font-display text-ink text-[26px] leading-none font-semibold tracking-[-0.04em] no-underline [font-variation-settings:'opsz'_48]",
        className,
      )}
    >
      sara
    </Link>
  );
}

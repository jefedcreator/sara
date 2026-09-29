import Link from "next/link";
import type { ReactNode } from "react";

import { MenuNumeral } from "./menu-numeral";

/** A numbered dashboard section, with an optional "see all" link. */
export function Panel({
  n,
  title,
  href,
  hrefLabel,
  children,
}: {
  n: number;
  title: string;
  href?: string;
  hrefLabel?: string;
  children: ReactNode;
}) {
  const id = `panel-${n}`;
  return (
    <section aria-labelledby={id} className="rounded-panel bg-surface px-[18px] pt-[22px] pb-5 sm:px-6">
      <header className="mb-[18px] flex items-center gap-3">
        <MenuNumeral n={n} />
        <h2 id={id} className="font-display text-[19px] leading-[1.2] font-medium tracking-[-0.02em]">
          {title}
        </h2>
        {href ? (
          <Link
            href={href}
            className="text-ink-2 hover:text-ink decoration-accent-tint ml-auto text-sm font-semibold underline underline-offset-4"
          >
            {hrefLabel ?? "See all"}
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

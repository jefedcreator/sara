import type { ReactNode } from "react";

/** A settings panel: title, one line of why, then its controls. */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-panel bg-surface px-[18px] pt-[22px] pb-6 sm:px-7 sm:pt-7">
      <h2 id={id} className="font-display text-[19px] leading-[1.2] font-medium tracking-[-0.02em]">
        {title}
      </h2>
      <p className="text-muted mt-1.5 max-w-[56ch] text-[15px] text-pretty">{description}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

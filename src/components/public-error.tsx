import type { ReactNode } from "react";

import { Wordmark } from "@/primitives";

/** A calm full-page message for public pages that can't show their content. */
export function PublicError({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <main className="bg-canvas text-ink flex min-h-dvh flex-col px-4 md:px-8">
      <header className="flex h-16 items-center">
        <Wordmark />
      </header>
      <section className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center pb-24">
        <h1 className="font-display text-[clamp(1.9rem,1.3rem+2.2vw,2.6rem)] leading-[1.06] font-normal tracking-[-0.035em] text-balance">
          {title}
        </h1>
        <p className="text-muted mt-3.5 max-w-[46ch] text-pretty">{body}</p>
        {children ? <div className="mt-8">{children}</div> : null}
      </section>
    </main>
  );
}

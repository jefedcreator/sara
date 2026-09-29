import type { ReactNode } from "react";

import { Wordmark } from "@/primitives";

import { SetupSteps } from "./setup-steps";

/** The frame for the owner's setup pages: wordmark, progress, one panel. */
export function SetupShell({
  step,
  title,
  body,
  children,
}: {
  step: 0 | 1 | 2;
  title: string;
  body: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="bg-canvas text-ink min-h-dvh px-4 pb-20 md:px-8">
      <header className="max-w-page mx-auto flex h-16 items-center">
        <Wordmark />
      </header>
      <div className="mx-auto w-full max-w-[560px] pt-6 md:pt-14">
        <SetupSteps current={step} />
        <h1 className="font-display animate-rise mt-8 text-[clamp(1.9rem,1.3rem+2.2vw,2.8rem)] leading-[1.06] font-normal tracking-[-0.035em] text-balance">
          {title}
        </h1>
        <div className="text-muted animate-rise-1 mt-3.5 max-w-[50ch] text-pretty">{body}</div>
        <div className="animate-rise-2 mt-8">{children}</div>
      </div>
    </main>
  );
}

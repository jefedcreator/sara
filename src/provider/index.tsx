"use client";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";

import { QueryProvider } from "./query-provider";

// Light only: DESIGN.md has no dark theme, so there is no ThemeProvider here.
export function Provider({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <NuqsAdapter>{children}</NuqsAdapter>
    </QueryProvider>
  );
}

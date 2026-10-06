"use client";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useEffect, type ReactNode } from "react";

import { cleanAuthFragment } from "@/utils/auth-fragment";
import { QueryProvider } from "./query-provider";

function CleanAuthFragment() {
  useEffect(() => {
    cleanAuthFragment();
  }, []);
  return null;
}

// Light only: DESIGN.md has no dark theme, so there is no ThemeProvider here.
export function Provider({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <NuqsAdapter>
        <CleanAuthFragment />
        {children}
      </NuqsAdapter>
    </QueryProvider>
  );
}

import type { ReactNode } from "react";

import { AppChrome } from "@/components/app-chrome";
import { requireBusiness } from "@/server";

/**
 * The signed-in owner app. Sends anyone signed out to sign in, and anyone
 * without a business through setup, then mounts the chrome once.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { business } = await requireBusiness("/services");

  return (
    <div className="bg-canvas text-ink min-h-dvh">
      <AppChrome businessName={business.name} />
      <main className="max-w-page mx-auto px-4 pt-8 pb-24 md:px-8 md:pt-12">{children}</main>
    </div>
  );
}

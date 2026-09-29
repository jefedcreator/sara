import type { ReactNode } from "react";

import { AppChrome } from "@/components/app-chrome";
import { getCurrentUser } from "@/server";

/**
 * The signed-in owner app: mounts the chrome once. Each page gates itself
 * with requireBusiness(<its own path>), because a layout can't see the path
 * and would send every signed-out visit back to the same place.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  return (
    <div className="bg-canvas text-ink min-h-dvh">
      <AppChrome businessName={user?.business?.name ?? ""} />
      <main className="max-w-page mx-auto px-4 pt-8 pb-24 md:px-8 md:pt-12">{children}</main>
    </div>
  );
}

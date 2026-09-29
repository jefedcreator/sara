import { redirect } from "next/navigation";
import { cache } from "react";

import { authService } from "@/backend/services/auth";
import { auth } from "@/server/auth";

/**
 * The signed-in owner (with their business). The Auth.js JWT says who the
 * visitor claims to be; the `Session` row it names must still be live, the
 * same check the API's authMiddleware makes. Null when signed out or
 * expired. cache()d: a layout and its page share one lookup.
 */
export const getCurrentUser = cache(async () => {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.sessionId) return null;

    const live = await authService.findLiveSession({
      userId: session.user.id,
      sessionId: session.user.sessionId,
    });
    return live?.user ?? null;
  } catch (error) {
    console.error("[session] lookup failed:", error);
    return null;
  }
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export function signInPath(next: string) {
  return `/signin?next=${encodeURIComponent(next)}`;
}

/** The owner, or a redirect to sign in that comes back to `next`. */
export async function requireUser(next: string) {
  const user = await getCurrentUser();
  if (!user) redirect(signInPath(next));
  return user;
}

/** The owner and their business, sending them through setup when missing. */
export async function requireBusiness(next: string) {
  const user = await requireUser(next);
  if (!user.business) redirect(`/onboarding?next=${encodeURIComponent(next)}`);
  return { user, business: user.business };
}

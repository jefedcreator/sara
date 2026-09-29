import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/server/db";

const SESSION_COOKIE = "sara-session";

/**
 * The signed-in owner (with their business), read from the same
 * `sara-session` cookie the API's authMiddleware checks. Null when signed
 * out or expired. cache()d: a layout and its page share one lookup.
 */
export const getCurrentUser = cache(async () => {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionToken) return null;

  try {
    const session = await db.session.findUnique({
      where: { sessionToken },
      include: { user: { include: { business: true } } },
    });
    if (!session || session.expires <= new Date()) return null;
    return session.user;
  } catch (error) {
    console.error("[session] lookup failed:", error);
    return null;
  }
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export function signInPath(next: string) {
  return `/sign-in?next=${encodeURIComponent(next)}`;
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

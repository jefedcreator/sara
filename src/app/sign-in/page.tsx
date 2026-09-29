import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { authService, type SignInError } from "@/backend/services/auth";
import { Button, Notice, Wordmark } from "@/primitives";
import { getCurrentUser } from "@/server";
import { safeNextPath } from "@/utils/redirect";

// Each button starts that provider's OAuth flow, which comes back with the
// Auth.js session cookie the API and the app pages read.
const authProviders = [
  { id: "google", label: "Continue with Google" },
  { id: "facebook", label: "Continue with Facebook" },
  { id: "instagram", label: "Continue with Instagram" },
] as const;

const errorMessages: Record<SignInError, string> = {
  declined: "Sign-in was cancelled. Choose an account to try again.",
  expired: "That sign-in expired or was started in another tab. Please try again.",
  failed: "We couldn't sign you in with that account. Please try again.",
  unavailable: "That sign-in option isn't available right now.",
};

export const metadata: Metadata = {
  title: "Sign in · Sara",
};

function authorizeHref(provider: string, next: string) {
  return `/api/auth/${provider}?${new URLSearchParams({ next }).toString()}`;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const error =
    typeof params.error === "string" && Object.hasOwn(errorMessages, params.error)
      ? errorMessages[params.error as SignInError]
      : null;
  const user = await getCurrentUser();

  // Already signed in and on the way somewhere: carry on.
  if (user && params.next) redirect(next);

  return (
    <main className="bg-canvas text-ink flex min-h-dvh items-center justify-center px-4 py-16 md:px-8">
      <section className="max-w-page grid w-full gap-12 lg:grid-cols-[1fr_400px] lg:items-center lg:gap-20">
        <div className="max-w-2xl">
          <Wordmark className="mb-10 inline-block" />
          <h1 className="font-display text-[clamp(2.4rem,1.4rem+3.6vw,4rem)] leading-[1.04] font-[380] tracking-[-0.04em] text-balance">
            Sign in to run your business from the web.
          </h1>
          <p className="text-muted mt-6 max-w-[46ch] text-lg">
            Use Google, Facebook, or Instagram. New accounts are created the
            first time you sign in.
          </p>
        </div>

        <div className="rounded-panel bg-surface p-6 sm:p-8">
          {user ? (
            <div className="space-y-6">
              <div>
                <p className="text-muted text-sm font-medium">Signed in as</p>
                <p className="font-display mt-1 text-2xl font-medium tracking-[-0.02em]">
                  {user.name ?? user.email ?? "Your account"}
                </p>
                {user.email ? (
                  <p className="text-muted mt-1 text-sm">{user.email}</p>
                ) : null}
                {user.provider ? (
                  <p className="bg-accent-soft text-accent-ink mt-3 inline-block rounded-full px-3 py-1.5 text-[13px] font-semibold">
                    Signed in with {user.provider}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-3">
                <Button asChild className="w-full">
                  <a href={user.business ? "/dashboard" : "/onboarding"}>
                    {user.business ? "Go to your dashboard" : "Set up your business"}
                  </a>
                </Button>
                <form action="/api/auth/logout" method="post">
                  <Button type="submit" variant="secondary" className="w-full">
                    Sign out
                  </Button>
                </form>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-[28px] leading-[1.1] font-normal tracking-[-0.03em]">
                  Log in or sign up
                </h2>
                <p className="text-muted mt-2 text-[15px]">
                  We only use your account to sign you in.
                </p>
              </div>

              {error ? <Notice tone="danger">{error}</Notice> : null}

              <div className="space-y-3">
                {authProviders.map((provider) =>
                  authService.isConfigured(provider.id) ? (
                    <Button
                      key={provider.id}
                      asChild
                      variant="secondary"
                      className="w-full"
                    >
                      <a href={authorizeHref(provider.id, next)}>
                        {provider.label}
                      </a>
                    </Button>
                  ) : (
                    <Button
                      key={provider.id}
                      variant="secondary"
                      className="w-full"
                      disabled
                      title={`Add ${provider.id} OAuth credentials to enable this provider`}
                    >
                      {provider.label}
                    </Button>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

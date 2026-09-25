import { type Metadata } from "next";
import Link from "next/link";

import { env } from "@/env";
import { auth, signIn, signOut } from "@/server/auth";

const authProviders = [
  {
    id: "google",
    label: "Continue with Google",
    isConfigured: Boolean(
      (env.AUTH_GOOGLE_ID ?? env.CLIENT_ID) &&
      (env.AUTH_GOOGLE_SECRET ?? env.CLIENT_SECRET),
    ),
  },
  {
    id: "facebook",
    label: "Continue with Facebook",
    isConfigured: Boolean(
      (env.AUTH_FACEBOOK_ID ?? env.FACEBOOK_CLIENT_ID) &&
      (env.AUTH_FACEBOOK_SECRET ?? env.FACEBOOK_CLIENT_SECRET),
    ),
  },
  {
    id: "instagram",
    label: "Continue with Instagram",
    isConfigured: Boolean(
      (env.AUTH_INSTAGRAM_ID ?? env.INSTAGRAM_CLIENT_ID) &&
      (env.AUTH_INSTAGRAM_SECRET ?? env.INSTAGRAM_CLIENT_SECRET),
    ),
  },
] as const;

export const metadata: Metadata = {
  title: "Sign in · Sara",
};

export default async function SignInPage() {
  const session = await auth();

  return (
    <main className="bg-canvas text-ink flex min-h-dvh items-center justify-center px-4 py-16 md:px-8">
      <section className="max-w-page grid w-full gap-12 lg:grid-cols-[1fr_400px] lg:items-center lg:gap-20">
        <div className="max-w-2xl">
          <Link
            href="/"
            className="font-display text-ink mb-10 inline-block text-[26px] leading-none font-semibold tracking-[-0.04em]"
          >
            sara
          </Link>
          <h1 className="font-display text-[clamp(2.4rem,1.4rem+3.6vw,4rem)] leading-[1.04] font-[380] tracking-[-0.04em] text-balance">
            Sign in and manage your business in one place.
          </h1>
          <p className="text-muted mt-6 max-w-[46ch] text-lg">
            Use Google, Facebook, or Instagram to create your account or return
            to your workspace.
          </p>
        </div>

        <div className="rounded-panel bg-surface p-6 sm:p-8">
          {session?.user ? (
            <div className="space-y-6">
              <div>
                <p className="text-muted text-sm font-medium">Signed in as</p>
                <p className="font-display mt-1 text-2xl font-medium tracking-[-0.02em]">
                  {session.user.name ?? session.user.email ?? "Your account"}
                </p>
                {session.user.email ? (
                  <p className="text-muted mt-1 text-sm">
                    {session.user.email}
                  </p>
                ) : null}
                {session.user.provider ? (
                  <p className="bg-accent-soft text-accent-ink mt-3 inline-block rounded-full px-3 py-1.5 text-[13px] font-semibold">
                    Signed in with {session.user.provider}
                  </p>
                ) : null}
              </div>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/sign-in" });
                }}
              >
                <button className="border-line bg-canvas text-ink ease-out-expo hover:border-ink h-12 w-full rounded-full border px-6 text-[15px] font-semibold transition-colors duration-200 active:scale-[0.98]">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-[28px] leading-[1.1] font-normal tracking-[-0.03em]">
                  Log in or sign up
                </h2>
                <p className="text-muted mt-2 text-[15px]">
                  New accounts are created automatically after provider
                  verification.
                </p>
              </div>

              {authProviders.length > 0 ? (
                <div className="space-y-3">
                  {authProviders.map((provider) =>
                    provider.isConfigured ? (
                      <form
                        key={provider.id}
                        action={async () => {
                          "use server";
                          await signIn(provider.id, { redirectTo: "/sign-in" });
                        }}
                      >
                        <button className="border-line bg-canvas text-ink ease-out-expo hover:border-ink h-12 w-full rounded-full border px-6 text-[15px] font-semibold transition-colors duration-200 active:scale-[0.98]">
                          {provider.label}
                        </button>
                      </form>
                    ) : (
                      <button
                        key={provider.id}
                        className="bg-line text-faint h-12 w-full cursor-not-allowed rounded-full px-6 text-[15px] font-semibold"
                        disabled
                        title={`Add ${provider.id} OAuth credentials to enable this provider`}
                      >
                        {provider.label}
                      </button>
                    ),
                  )}
                </div>
              ) : (
                <p className="rounded-card bg-canvas text-ink-2 px-4 py-3 text-sm">
                  Add OAuth credentials to enable social sign-in.
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

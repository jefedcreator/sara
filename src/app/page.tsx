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

export default async function HomePage() {
  const session = await auth();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-16 text-ink md:px-8">
      <section className="grid w-full max-w-page gap-12 lg:grid-cols-[1fr_400px] lg:items-center lg:gap-20">
        <div className="max-w-2xl">
          <p className="mb-10 font-display text-[26px] leading-none font-semibold tracking-[-0.04em]">
            sara
          </p>
          <h1 className="font-display text-[clamp(2.4rem,1.4rem+3.6vw,4rem)] leading-[1.04] font-[380] tracking-[-0.04em] text-balance">
            Sign in and manage your business in one place.
          </h1>
          <p className="mt-6 max-w-[46ch] text-lg text-muted">
            Use Google, Facebook, or Instagram to create your account or return
            to your workspace.
          </p>
        </div>

        <div className="rounded-panel bg-surface p-6 sm:p-8">
          {session?.user ? (
            <div className="space-y-6">
              <div>
                <p className="text-sm font-medium text-muted">
                  Signed in as
                </p>
                <p className="mt-1 font-display text-2xl font-medium tracking-[-0.02em]">
                  {session.user.name ?? session.user.email ?? "Your account"}
                </p>
                {session.user.email ? (
                  <p className="mt-1 text-sm text-muted">
                    {session.user.email}
                  </p>
                ) : null}
                {session.user.provider ? (
                  <p className="mt-3 inline-block rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent-ink">
                    Signed in with {session.user.provider}
                  </p>
                ) : null}
              </div>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button className="h-12 w-full rounded-full border border-line bg-canvas px-6 text-[15px] font-semibold text-ink transition-colors duration-200 ease-out-expo hover:border-ink active:scale-[0.98]">
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
                <p className="mt-2 text-[15px] text-muted">
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
                          await signIn(provider.id, { redirectTo: "/" });
                        }}
                      >
                        <button className="h-12 w-full rounded-full border border-line bg-canvas px-6 text-[15px] font-semibold text-ink transition-colors duration-200 ease-out-expo hover:border-ink active:scale-[0.98]">
                          {provider.label}
                        </button>
                      </form>
                    ) : (
                      <button
                        key={provider.id}
                        className="h-12 w-full cursor-not-allowed rounded-full bg-line px-6 text-[15px] font-semibold text-faint"
                        disabled
                        title={`Add ${provider.id} OAuth credentials to enable this provider`}
                      >
                        {provider.label}
                      </button>
                    ),
                  )}
                </div>
              ) : (
                <p className="rounded-card bg-canvas px-4 py-3 text-sm text-ink-2">
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

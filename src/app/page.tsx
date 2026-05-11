import { env } from "@/env";
import { authService } from "@/backend/services/auth";

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
  const user = await authService.getCurrentUserFromCustomSession();

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-16 text-zinc-50">
      <section className="grid w-full max-w-5xl gap-10 lg:grid-cols-[1fr_380px] lg:items-center">
        <div className="max-w-2xl">
          <p className="mb-4 text-sm font-medium tracking-[0.28em] text-emerald-300 uppercase">
            Sara
          </p>
          <h1 className="text-4xl font-semibold tracking-normal text-white sm:text-6xl">
            Sign in and manage your business in one place.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-zinc-300">
            Use Google, Facebook, or Instagram to create your account or return
            to your workspace.
          </p>
        </div>

        <div className="rounded-lg border border-white/10 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/30">
          {user ? (
            <div className="space-y-6">
              <div>
                <p className="text-sm font-medium text-zinc-500">
                  Signed in as
                </p>
                <p className="mt-1 text-xl font-semibold">
                  {user.name ?? user.email ?? "Your account"}
                </p>
                {user.email ? (
                  <p className="mt-1 text-sm text-zinc-500">{user.email}</p>
                ) : null}
              </div>
              <form action="/api/auth/logout" method="post">
                <button className="w-full rounded-md bg-zinc-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl font-semibold">Log in or sign up</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  New accounts are created automatically after provider
                  verification.
                </p>
              </div>

              {authProviders.length > 0 ? (
                <div className="space-y-3">
                  {authProviders.map((provider) =>
                    provider.isConfigured ? (
                      <a
                        key={provider.id}
                        className="block w-full rounded-md border border-zinc-200 bg-white px-4 py-3 text-center text-sm font-semibold text-zinc-950 transition hover:border-zinc-950 hover:bg-zinc-50"
                        href={`/api/auth/${provider.id}?redirect=true&callbackUrl=/`}
                      >
                        {provider.label}
                      </a>
                    ) : (
                      <button
                        key={provider.id}
                        className="w-full cursor-not-allowed rounded-md border border-zinc-200 bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-400"
                        disabled
                        title={`Add ${provider.id} OAuth credentials to enable this provider`}
                      >
                        {provider.label}
                      </button>
                    ),
                  )}
                </div>
              ) : (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
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

import type { DefaultSession, NextAuthConfig } from "next-auth";

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  readAuthSecret,
  sessionCookieAttributes,
} from "./shared";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      /** The `Session` row this JWT stands for; revoked by deleting it. */
      sessionId: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sessionId?: string;
  }
}

/**
 * Auth.js carries the session; it does not run the sign-in. The Google,
 * Facebook and Instagram flows live in services/auth, which mint this JWT
 * (`{ sub, sessionId }`) once the provider has vouched for the user. The JWT
 * proves we issued it; the `Session` row it names proves it is still meant to
 * work, and is what sign-out deletes.
 *
 * Edge-safe on purpose: middleware imports this file, so it must not import
 * the database, a provider SDK or `@/env`.
 */
export const authConfig = {
  providers: [],
  secret: readAuthSecret(),
  // Sara runs behind its own proxy in Docker as well as on hosted platforms;
  // no provider is registered here, so the host only shapes Auth.js's own URLs.
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  cookies: {
    sessionToken: { name: SESSION_COOKIE, options: sessionCookieAttributes },
  },
  callbacks: {
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      if (token.sessionId) session.user.sessionId = token.sessionId;
      return session;
    },
  },
  pages: {
    signIn: "/sign-in",
  },
} satisfies NextAuthConfig;

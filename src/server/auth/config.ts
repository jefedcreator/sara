import { PrismaAdapter } from "@auth/prisma-adapter";
import { Provider } from "@prisma/client";
import type { DefaultSession, NextAuthConfig } from "next-auth";
import FacebookProvider from "next-auth/providers/facebook";
import GoogleProvider from "next-auth/providers/google";
import InstagramProvider from "next-auth/providers/instagram";

import { env } from "@/env";
import { db } from "@/server/db";

// Use Provider from @prisma/client instead of local type definition

const providersList = ["google", "facebook", "instagram"] as const;

const isProvider = (provider?: string): provider is Provider =>
  providersList.includes(provider as Provider);

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      provider?: Provider | null;
    } & DefaultSession["user"];
  }

  interface User {
    provider?: Provider | null;
  }
}

const providers: NextAuthConfig["providers"] = [];

const addProvider = (
  provider: NextAuthConfig["providers"][number],
  clientId?: string,
  clientSecret?: string,
) => {
  if (clientId && clientSecret) {
    providers.push(provider);
  }
};

const getTokenProvider = (value: unknown): Provider | null => {
  if (typeof value !== "string") return null;
  return isProvider(value) ? value : null;
};

addProvider(
  GoogleProvider({
    clientId: env.AUTH_GOOGLE_ID ?? env.CLIENT_ID,
    clientSecret: env.AUTH_GOOGLE_SECRET ?? env.CLIENT_SECRET,
    authorization: {
      params: {
        access_type: "offline",
        response_type: "code",
      },
    },
  }),
  env.AUTH_GOOGLE_ID ?? env.CLIENT_ID,
  env.AUTH_GOOGLE_SECRET ?? env.CLIENT_SECRET,
);

addProvider(
  FacebookProvider({
    clientId: env.AUTH_FACEBOOK_ID ?? env.FACEBOOK_CLIENT_ID,
    clientSecret: env.AUTH_FACEBOOK_SECRET ?? env.FACEBOOK_CLIENT_SECRET,
  }),
  env.AUTH_FACEBOOK_ID ?? env.FACEBOOK_CLIENT_ID,
  env.AUTH_FACEBOOK_SECRET ?? env.FACEBOOK_CLIENT_SECRET,
);

addProvider(
  InstagramProvider({
    clientId: env.AUTH_INSTAGRAM_ID ?? env.INSTAGRAM_CLIENT_ID,
    clientSecret: env.AUTH_INSTAGRAM_SECRET ?? env.INSTAGRAM_CLIENT_SECRET,
  }),
  env.AUTH_INSTAGRAM_ID ?? env.INSTAGRAM_CLIENT_ID,
  env.AUTH_INSTAGRAM_SECRET ?? env.INSTAGRAM_CLIENT_SECRET,
);

export const authConfig = {
  providers,
  adapter: PrismaAdapter(db),
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ account, user }) {
      if (user.id && isProvider(account?.provider)) {
        user.provider = account.provider as Provider;

        await db.user.update({
          where: { id: user.id },
          data: { provider: account.provider as Provider },
        });
      }

      return true;
    },
    jwt: ({ token, account, user }) => {
      if (isProvider(account?.provider)) {
        token.provider = account.provider;
      } else if (user?.provider) {
        token.provider = user.provider;
      }

      return token;
    },
    session: ({ session, token }) => ({
      ...session,
      user: {
        ...session.user,
        id: token.sub!,
        provider: getTokenProvider(token.provider),
      },
    }),
  },
} satisfies NextAuthConfig;


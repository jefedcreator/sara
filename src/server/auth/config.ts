import { PrismaAdapter } from "@auth/prisma-adapter";
import type { DefaultSession, NextAuthConfig } from "next-auth";
import FacebookProvider from "next-auth/providers/facebook";
import GoogleProvider from "next-auth/providers/google";
import InstagramProvider from "next-auth/providers/instagram";

import { env } from "@/env";
import { db } from "@/server/db";

type LoginProvider = "google" | "facebook" | "instagram";

const loginProviders = ["google", "facebook", "instagram"] as const;

const isLoginProvider = (provider?: string): provider is LoginProvider =>
  loginProviders.includes(provider as LoginProvider);

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      loginProvider?: LoginProvider | null;
    } & DefaultSession["user"];
  }

  interface User {
    loginProvider?: LoginProvider | null;
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

const getTokenLoginProvider = (value: unknown): LoginProvider | null => {
  if (typeof value !== "string") return null;
  return isLoginProvider(value) ? value : null;
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
      if (user.id && isLoginProvider(account?.provider)) {
        user.loginProvider = account.provider;

        await db.user.update({
          where: { id: user.id },
          data: { loginProvider: account.provider },
        });
      }

      return true;
    },
    jwt: ({ token, account, user }) => {
      if (isLoginProvider(account?.provider)) {
        token.loginProvider = account.provider;
      } else if (user?.loginProvider) {
        token.loginProvider = user.loginProvider;
      }

      return token;
    },
    session: ({ session, token }) => ({
      ...session,
      user: {
        ...session.user,
        id: token.sub!,
        loginProvider: getTokenLoginProvider(token.loginProvider),
      },
    }),
  },
} satisfies NextAuthConfig;

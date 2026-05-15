import { randomBytes } from "node:crypto";
import type { Account, Provider, PrismaClient, User } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { db } from "@/server/db";

// export type Provider = "google" | "facebook" | "instagram";

type OAuthProviderConfig = {
  id: Provider;
  name: string;
  authorizationUrl: string;
  tokenUrl: string;
  scope: string;
  clientId?: string;
  clientSecret?: string;
  configurationId?: string;
};

type ConfiguredOAuthProvider = OAuthProviderConfig & {
  clientId: string;
  clientSecret: string;
};

type OAuthTokenSet = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
};

type OAuthProfile = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

type AuthenticatedUser = Pick<User, "id" | "name" | "email" | "image"> & {
  provider: Provider;
};

type CallbackBody = {
  code?: string;
  state?: string;
  sessionToken?: string;
};

type DecodedState = {
  callbackUrl?: string;
};

export class AuthService {
  private readonly sessionMaxAgeSeconds = 60 * 60 * 24 * 30;
  private readonly sessionCookieName = "sara-session";

  private readonly providerConfigs: Record<Provider, OAuthProviderConfig> = {
    google: {
      id: "google",
      name: "Google",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
      clientId: env.AUTH_GOOGLE_ID ?? env.CLIENT_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET ?? env.CLIENT_SECRET,
    },
    facebook: {
      id: "facebook",
      name: "Facebook",
      authorizationUrl: "https://www.facebook.com/v19.0/dialog/oauth",
      tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
      scope: "email public_profile",
      clientId: env.AUTH_FACEBOOK_ID ?? env.FACEBOOK_CLIENT_ID,
      clientSecret: env.AUTH_FACEBOOK_SECRET ?? env.FACEBOOK_CLIENT_SECRET,
      configurationId: env.CONFIGURATION_ID,
    },
    instagram: {
      id: "instagram",
      name: "Instagram",
      authorizationUrl: "https://api.instagram.com/oauth/authorize",
      tokenUrl: "https://api.instagram.com/oauth/access_token",
      scope: "instagram_business_basic", // ← replace user_profile
      clientId: env.AUTH_INSTAGRAM_ID ?? env.INSTAGRAM_CLIENT_ID,
      clientSecret: env.AUTH_INSTAGRAM_SECRET ?? env.INSTAGRAM_CLIENT_SECRET,
    },
  };

  constructor(private readonly prisma: PrismaClient = db) {}

  createAuthorizationResponse(request: NextRequest, providerId: Provider) {
    try {
      const provider = this.getConfiguredProvider(providerId);
      const redirectUri = this.getRedirectUri(request, provider.id);
      const shouldRedirect =
        request.nextUrl.searchParams.get("redirect") === "true";
      const state = this.encodeState({});

      const authorizationUrl = new URL(provider.authorizationUrl);
      authorizationUrl.searchParams.set("client_id", provider.clientId);
      authorizationUrl.searchParams.set("redirect_uri", redirectUri);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("scope", provider.scope);
      authorizationUrl.searchParams.set("state", state);

      if (provider.id === "google") {
        authorizationUrl.searchParams.set("scope", provider.scope);
        authorizationUrl.searchParams.set("access_type", "offline");
      } else if (provider.id === "facebook" && provider.configurationId) {
        authorizationUrl.searchParams.set(
          "config_id",
          provider.configurationId,
        );
      } else {
        authorizationUrl.searchParams.set("scope", provider.scope);
      }
      if (shouldRedirect) {
        return NextResponse.redirect(authorizationUrl);
      }

      return NextResponse.json({
        provider: provider.id,
        authorizationUrl: authorizationUrl.toString(),
      });
    } catch (error) {
      return this.oauthErrorResponse(error);
    }
  }

  async createCallbackResponse(request: NextRequest, providerId: Provider) {
    try {
      const provider = this.getConfiguredProvider(providerId);
      const body = await this.getCallbackBody(request);
      const code = request.nextUrl.searchParams.get("code") ?? body?.code;
      const sessionTokenParam =
        request.nextUrl.searchParams.get("sessionToken") ?? body?.sessionToken;

      if (!code) {
        if (sessionTokenParam) {
          const session = await this.prisma.session.findUnique({
            where: { sessionToken: sessionTokenParam },
            include: { user: { include: { business: true } } },
          });

          if (session && session.expires > new Date()) {
            const state = this.decodeState(
              request.nextUrl.searchParams.get("state") ?? body?.state ?? null,
            );

            if (state.callbackUrl) {
              const redirectUrl = new URL(
                state.callbackUrl,
                this.getAppUrl(request),
              );
              redirectUrl.searchParams.set("sessionToken", sessionTokenParam);

              const response = NextResponse.redirect(redirectUrl);
              this.setSessionCookie(response, sessionTokenParam);
              return response;
            }

            const user = this.toAuthenticatedUser(session.user, provider.id);
            const response = NextResponse.json({
              user,
              sessionToken: sessionTokenParam,
              tokenType: "Bearer",
              expiresIn: this.sessionMaxAgeSeconds,
            });

            this.setSessionCookie(response, sessionTokenParam);
            return response;
          }
        }

        return NextResponse.json(
          { error: "Missing OAuth authorization code." },
          { status: 400 },
        );
      }

      const tokenSet = await this.exchangeCodeForToken(
        provider,
        code,
        this.getRedirectUri(request, provider.id),
      );
      const profile = await this.fetchProviderProfile(provider.id, tokenSet);
      console.log("profile", profile);

      const user = await this.findOrCreateOAuthUser(
        provider.id,
        profile,
        tokenSet,
      );
      const sessionToken = await this.createUserSession(user.id);
      const state = this.decodeState(
        request.nextUrl.searchParams.get("state") ?? body?.state ?? null,
      );

      if (state.callbackUrl) {
        const redirectUrl = new URL(state.callbackUrl, this.getAppUrl(request));
        redirectUrl.searchParams.set("sessionToken", sessionToken);

        const response = NextResponse.redirect(redirectUrl);
        this.setSessionCookie(response, sessionToken);
        return response;
      }

      const response = NextResponse.json({
        user,
        sessionToken,
        tokenType: "Bearer",
        expiresIn: this.sessionMaxAgeSeconds,
      });

      this.setSessionCookie(response, sessionToken);
      return response;
    } catch (error) {
      console.log("error??", error);
      return this.oauthErrorResponse(error);
    }
  }

  async getCurrentUserFromCustomSession() {
    const { cookies } = await import("next/headers");
    const sessionToken = (await cookies()).get(this.sessionCookieName)?.value;

    if (!sessionToken) return null;

    const session = await this.prisma.session.findUnique({
      where: { sessionToken },
      include: { user: { include: { business: true } } },
    });

    if (!session || session.expires <= new Date()) return null;

    return session.user;
  }

  private getAppUrl(request: NextRequest) {
    return (
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      `${request.nextUrl.protocol}//${request.nextUrl.host}`
    );
  }

  private getRedirectUri(request: NextRequest, provider: Provider) {
    return new URL(
      `/api/auth/${provider}/callback`,
      this.getAppUrl(request),
    ).toString();
  }

  private getConfiguredProvider(providerId: Provider): ConfiguredOAuthProvider {
    const provider = this.providerConfigs[providerId];

    if (!provider.clientId || !provider.clientSecret) {
      throw new Error(`${provider.name} OAuth credentials are not configured.`);
    }

    return provider as ConfiguredOAuthProvider;
  }

  private encodeState(value: Record<string, string | null>) {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  }

  private decodeState(state: string | null): DecodedState {
    if (!state) return {};

    try {
      return JSON.parse(
        Buffer.from(state, "base64url").toString("utf8"),
      ) as DecodedState;
    } catch {
      return {};
    }
  }

  private async getCallbackBody(request: NextRequest) {
    if (request.method !== "POST") return null;

    return request.json().catch(() => null) as Promise<CallbackBody | null>;
  }

  private async exchangeCodeForToken(
    provider: ConfiguredOAuthProvider,
    code: string,
    redirectUri: string,
  ): Promise<OAuthTokenSet> {
    if (provider.id === "google" || provider.id === "instagram") {
      const body = new URLSearchParams({
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      });

      const response = await fetch(provider.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      return this.parseTokenResponse(response);
    }

    const tokenUrl = new URL(provider.tokenUrl);
    tokenUrl.searchParams.set("client_id", provider.clientId);
    tokenUrl.searchParams.set("client_secret", provider.clientSecret);
    tokenUrl.searchParams.set("code", code);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);

    return this.parseTokenResponse(await fetch(tokenUrl));
  }

  private async parseTokenResponse(response: Response): Promise<OAuthTokenSet> {
    const payload = (await response.json()) as
      | OAuthTokenSet
      | { error?: string; error_description?: string; message?: string };

    if (!response.ok || !("access_token" in payload)) {
      const message =
        "error_description" in payload
          ? payload.error_description
          : "message" in payload
            ? payload.message
            : "OAuth token exchange failed.";
      throw new Error(message ?? "OAuth token exchange failed.");
    }

    return payload;
  }

  private async fetchProviderProfile(
    providerId: Provider,
    tokenSet: OAuthTokenSet,
  ): Promise<OAuthProfile> {
    if (providerId === "google") {
      const profile = (await this.fetchJson(
        "https://openidconnect.googleapis.com/v1/userinfo",
        tokenSet.access_token,
      )) as {
        sub: string;
        name?: string;
        email?: string;
        picture?: string;
      };

      return {
        id: profile.sub,
        name: profile.name ?? null,
        email: profile.email ?? null,
        image: profile.picture ?? null,
      };
    }

    if (providerId === "facebook") {
      const profile = (await this.fetchJson(
        "https://graph.facebook.com/me?fields=id,name,email,picture",
        tokenSet.access_token,
      )) as {
        id: string;
        name?: string;
        email?: string;
        picture?: { data?: { url?: string } };
      };

      return {
        id: profile.id,
        name: profile.name ?? null,
        email: profile.email ?? null,
        image: profile.picture?.data?.url ?? null,
      };
    }

    const instagramUrl = new URL("https://graph.instagram.com/me");
    instagramUrl.searchParams.set("fields", "id,username,account_type,name");
    instagramUrl.searchParams.set("access_token", tokenSet.access_token);

    const profile = (await fetch(instagramUrl).then((response) =>
      response.json(),
    )) as {
      id: string;
      username?: string;
      name?: string;
    };

    return {
      id: profile.id,
      name: profile.name ?? profile.username ?? null,
      email: null,
      image: null,
    };
  }

  private fetchJson(url: string, accessToken: string) {
    return fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(async (response) => {
      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error("Failed to fetch provider profile.");
      }

      return payload;
    });
  }

  private async findOrCreateOAuthUser(
    provider: Provider,
    profile: OAuthProfile,
    tokenSet: OAuthTokenSet,
  ): Promise<AuthenticatedUser> {
    const existingAccount = await this.prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId: profile.id,
        },
      },
      include: { user: true },
    });

    const accountData = this.createAccountData(provider, profile.id, tokenSet);

    if (existingAccount) {
      const [updatedUser] = await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: existingAccount.userId },
          data: {
            name: profile.name ?? existingAccount.user.name,
            email: profile.email ?? existingAccount.user.email,
            image: profile.image ?? existingAccount.user.image,
            provider,
          },
        }),
        this.prisma.account.update({
          where: { id: existingAccount.id },
          data: accountData,
        }),
      ]);

      return this.toAuthenticatedUser(updatedUser, provider);
    }

    const existingUser = profile.email
      ? await this.prisma.user.findUnique({ where: { email: profile.email } })
      : null;

    if (existingUser) {
      const user = await this.prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name: profile.name ?? existingUser.name,
          image: profile.image ?? existingUser.image,
          provider,
          accounts: {
            create: accountData,
          },
        },
      });

      return this.toAuthenticatedUser(user, provider);
    }

    const user = await this.prisma.user.create({
      data: {
        name: profile.name,
        email: profile.email,
        image: profile.image,
        provider: provider,
        accounts: {
          create: accountData,
        },
      },
    });

    return this.toAuthenticatedUser(user, provider);
  }

  private createAccountData(
    provider: Provider,
    providerAccountId: string,
    tokenSet: OAuthTokenSet,
  ): Omit<Account, "id" | "userId"> {
    return {
      type: provider === "google" ? "oidc" : "oauth",
      provider,
      providerAccountId,
      refresh_token: tokenSet.refresh_token ?? null,
      access_token: tokenSet.access_token,
      expires_at: tokenSet.expires_in
        ? Math.floor(Date.now() / 1000) + tokenSet.expires_in
        : null,
      token_type: tokenSet.token_type ?? null,
      scope: tokenSet.scope ?? null,
      id_token: tokenSet.id_token ?? null,
      session_state: null,
    };
  }

  private async createUserSession(userId: string) {
    const sessionToken = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + this.sessionMaxAgeSeconds * 1000);

    await this.prisma.session.create({
      data: {
        sessionToken,
        userId,
        expires,
      },
    });

    return sessionToken;
  }

  private setSessionCookie(response: NextResponse, sessionToken: string) {
    response.cookies.set(this.sessionCookieName, sessionToken, {
      httpOnly: true,
      maxAge: this.sessionMaxAgeSeconds,
      path: "/",
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
    });
  }

  private toAuthenticatedUser(
    user: User,
    provider: Provider,
  ): AuthenticatedUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      provider,
    };
  }

  private oauthErrorResponse(error: unknown) {
    const message =
      error instanceof Error ? error.message : "OAuth authentication failed.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export const authService = new AuthService();

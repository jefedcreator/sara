import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient, Provider, User } from "@prisma/client";
import { decode, encode } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

import { emailService } from "@/backend/services/email";
import { env } from "@/env";
import { db } from "@/server/db";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from "@/server/auth/shared";
import { safeNextPath } from "@/utils/redirect";
import { appBaseUrl } from "@/utils/url";

import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
  OAUTH_VERIFIER_COOKIE,
  buildAuthorizationUrl,
  createNonce,
  createPkcePair,
  exchangeCode,
  signState,
  usesPkce,
  verifyState,
  type OAuthClient,
  type OAuthResult,
} from "./oauth";

/** Who a session JWT claims to be, before the database has agreed. */
export type SessionClaim = { userId: string; sessionId: string };

/** Why sign-in bounced back to /signin. Short codes, never provider text. */
export type SignInError = "declined" | "expired" | "failed" | "unavailable";

export class AuthService {
  constructor(private readonly prisma: PrismaClient = db) {}

  private credentials(provider: Provider) {
    switch (provider) {
      case "google":
        return {
          clientId: env.CLIENT_ID ?? env.AUTH_GOOGLE_ID,
          clientSecret: env.CLIENT_SECRET ?? env.AUTH_GOOGLE_SECRET,
        };
      case "facebook":
        return {
          clientId: env.FACEBOOK_CLIENT_ID ?? env.AUTH_FACEBOOK_ID,
          clientSecret: env.FACEBOOK_CLIENT_SECRET ?? env.AUTH_FACEBOOK_SECRET,
          configurationId: env.CONFIGURATION_ID,
        };
      case "instagram":
        return {
          clientId: env.INSTAGRAM_CLIENT_ID ?? env.AUTH_INSTAGRAM_ID,
          clientSecret:
            env.INSTAGRAM_CLIENT_SECRET ?? env.AUTH_INSTAGRAM_SECRET,
        };
    }
  }

  isConfigured(provider: Provider) {
    const { clientId, clientSecret } = this.credentials(provider);
    return Boolean(clientId && clientSecret);
  }

  /** The public origin: providers match the redirect URI exactly. */
  private appOrigin(request: NextRequest) {
    const proto =
      request.headers.get("x-forwarded-proto") ??
      request.nextUrl.protocol.replace(/:$/, "");
    let origin = appBaseUrl(request.nextUrl.origin);
    if (
      proto === "https" &&
      origin.startsWith("http://") &&
      !origin.includes("localhost") &&
      !origin.includes("127.0.0.1")
    ) {
      origin = origin.replace(/^http:\/\//, "https://");
    }
    return origin;
  }

  private client(provider: Provider, origin: string): OAuthClient | null {
    const { clientId, clientSecret, ...rest } = this.credentials(provider);
    if (!clientId || !clientSecret) return null;
    return {
      provider,
      clientId,
      clientSecret,
      redirectUri: `${origin}/api/auth/${provider}/callback`,
      ...rest,
    };
  }

  private secret() {
    if (!env.AUTH_SECRET) throw new Error("AUTH_SECRET is not set.");
    return env.AUTH_SECRET;
  }

  /** GET /api/auth/{provider}: off to the provider's consent screen. */
  startSignIn(request: NextRequest, provider: Provider) {
    const origin = this.appOrigin(request);
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    const client = this.client(provider, origin);
    if (!client) return this.signInFailure(origin, "unavailable", next);

    const nonce = createNonce();
    const { verifier, challenge } = createPkcePair();
    const state = signState({ provider, nonce, next }, this.secret());

    const response = NextResponse.redirect(
      buildAuthorizationUrl(client, state, challenge),
    );
    // Spent within one consent round trip; they must not outlive it.
    const options = sessionCookieOptions(OAUTH_STATE_MAX_AGE_SECONDS);
    response.cookies.set(OAUTH_STATE_COOKIE, nonce, options);
    if (usesPkce(provider)) {
      response.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, options);
    }
    return response;
  }

  /**
   * GET /api/auth/{provider}/callback: checks the state, redeems the code,
   * signs the user in and returns them to where they were going.
   */
  async completeSignIn(request: NextRequest, provider: Provider) {
    const origin = this.appOrigin(request);
    const params = request.nextUrl.searchParams;

    // Signature first: nothing in a state we did not mint can be trusted.
    // Then the CSRF check: without it, an attacker could finish this flow
    // with their own code in the victim's browser and sign them in as the
    // attacker.
    const state = verifyState(params.get("state"), this.secret());
    const nonce = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
    if (state?.provider !== provider || state.nonce !== nonce) {
      return this.signInFailure(origin, "expired");
    }

    const next = safeNextPath(state.next);
    // Providers report a refused consent this way rather than as an HTTP error.
    if (params.get("error"))
      return this.signInFailure(origin, "declined", next);

    const code = params.get("code");
    const client = this.client(provider, origin);
    if (!client) return this.signInFailure(origin, "unavailable", next);
    if (!code) return this.signInFailure(origin, "failed", next);

    try {
      const result = await exchangeCode(
        client,
        code,
        request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value ?? null,
        { fetch, now: new Date() },
      );
      const user = await this.signInWithOAuth(provider, result);
      const token = await this.issueSession(user.id);

      const response = NextResponse.redirect(new URL(next, origin));
      response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
      this.clearOAuthCookies(response);
      return response;
    } catch (error) {
      console.error(`[auth] ${provider} sign-in failed:`, error);
      return this.signInFailure(origin, "failed", next);
    }
  }

  private signInFailure(origin: string, error: SignInError, next?: string) {
    const url = new URL("/signin", origin);
    url.searchParams.set("error", error);
    if (next) url.searchParams.set("next", next);
    const response = NextResponse.redirect(url);
    this.clearOAuthCookies(response);
    return response;
  }

  private clearOAuthCookies(response: NextResponse) {
    response.cookies.set(OAUTH_STATE_COOKIE, "", sessionCookieOptions(0));
    response.cookies.set(OAUTH_VERIFIER_COOKIE, "", sessionCookieOptions(0));
  }

  /**
   * The user this provider account belongs to, linking or creating as needed.
   * `profile.email` is only ever set when the provider vouches for the
   * address (see oauth.ts), which is what makes linking on it safe.
   */
  async signInWithOAuth(
    provider: Provider,
    { profile, tokens }: OAuthResult,
  ): Promise<User> {
    const account = {
      type: provider === "google" ? "oidc" : "oauth",
      provider,
      providerAccountId: profile.id,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
      token_type: tokens.tokenType,
      scope: tokens.scope,
      id_token: tokens.idToken,
    } satisfies Prisma.AccountCreateWithoutUserInput;

    // 1. A provider account we already know. Keyed on the provider's id, so
    //    it still resolves after the user changes their email.
    const linked = await this.prisma.account.findUnique({
      where: {
        provider_providerAccountId: { provider, providerAccountId: profile.id },
      },
      include: { user: true },
    });
    if (linked) {
      await this.prisma.account.update({
        where: { id: linked.id },
        data: account,
      });
      return this.prisma.user.update({
        where: { id: linked.userId },
        data: {
          provider,
          name: linked.user.name ?? profile.name,
          image: linked.user.image ?? profile.image,
        },
      });
    }

    // 2. An owner already signed up at this verified address: link, don't
    //    duplicate.
    const byEmail = profile.email
      ? await this.prisma.user.findUnique({ where: { email: profile.email } })
      : null;
    if (byEmail) {
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          provider,
          name: byEmail.name ?? profile.name,
          image: byEmail.image ?? profile.image,
          emailVerified: byEmail.emailVerified ?? new Date(),
          accounts: { create: account },
        },
      });
    }

    // 3. Someone new: create them, and welcome them if the provider gave a
    //    verified address. The email never fails the sign-in (emailService).
    const user = await this.prisma.user.create({
      data: {
        provider,
        name: profile.name,
        email: profile.email,
        emailVerified: profile.email ? new Date() : null,
        image: profile.image,
        accounts: { create: account },
      },
    });
    if (user.email) {
      await emailService.sendWelcomeEmail({ to: user.email, name: user.name });
    }
    return user;
  }

  /** Opens a `Session` row and returns the Auth.js JWT that names it. */
  async issueSession(userId: string) {
    const session = await this.prisma.session.create({
      data: {
        // Unused as a credential now that the JWT carries the session id,
        // but the column is unique and required.
        sessionToken: randomBytes(32).toString("base64url"),
        userId,
        expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
      },
    });

    return encode({
      token: { sub: userId, sessionId: session.id },
      secret: this.secret(),
      salt: SESSION_COOKIE,
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  }

  /**
   * The claim a request's session JWT makes, from the cookie or, for
   * non-browser clients, `Authorization: Bearer <jwt>`. Signature and expiry
   * only; findLiveSession decides whether it still counts.
   */
  async readClaim(request: NextRequest): Promise<SessionClaim | null> {
    const raw =
      request.cookies.get(SESSION_COOKIE)?.value ??
      /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    const secret = env.AUTH_SECRET;
    if (!raw || !secret) return null;

    const token = await decode({
      token: raw,
      secret,
      salt: SESSION_COOKIE,
    }).catch(() => null);
    if (!token?.sub || typeof token.sessionId !== "string") return null;
    return { userId: token.sub, sessionId: token.sessionId };
  }

  /**
   * The session behind a claim, with its owner and business, or null when it
   * was signed out, has expired, or belongs to someone else. This is what
   * makes a signed JWT insufficient on its own.
   */
  async findLiveSession(claim: SessionClaim) {
    const session = await this.prisma.session.findUnique({
      where: { id: claim.sessionId },
      include: { user: { include: { business: true } } },
    });
    if (session?.userId !== claim.userId) return null;
    if (session.expires <= new Date()) {
      await this.prisma.session
        .delete({ where: { id: session.id } })
        .catch(() => undefined);
      return null;
    }
    return session;
  }

  async sessionFromRequest(request: NextRequest) {
    const claim = await this.readClaim(request);
    return claim ? this.findLiveSession(claim) : null;
  }

  /** Revokes the request's session. The caller clears the cookie. */
  async signOut(request: NextRequest) {
    const claim = await this.readClaim(request);
    if (!claim) return;
    await this.prisma.session.deleteMany({
      where: { id: claim.sessionId, userId: claim.userId },
    });
  }
}

export const authService = new AuthService();

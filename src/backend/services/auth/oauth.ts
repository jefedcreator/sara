// Google, Facebook and Instagram sign-in: the pure half. Nothing here reads
// the environment or touches the database -- credentials, the secret and the
// clock arrive as arguments -- so every security check below can be tested
// without a live provider. index.ts composes these into the full flow.

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Provider } from "@prisma/client";

const GRAPH_VERSION = "v23.0";

export const OAUTH_STATE_COOKIE = "sara-oauth-state";
export const OAUTH_VERIFIER_COOKIE = "sara-oauth-verifier";
/** Consent should not take longer than this; a stale state must not be reusable. */
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthError";
  }
}

export type OAuthClient = {
  provider: Provider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Facebook Login for Business configuration; replaces `scope` when set. */
  configurationId?: string;
};

export type OAuthProfile = {
  /** The provider's stable account id, never the email. */
  id: string;
  name: string | null;
  /** Lowercased, and only set when the provider vouches for the address. */
  email: string | null;
  image: string | null;
};

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  tokenType: string | null;
  scope: string | null;
  idToken: string | null;
};

export type OAuthResult = { profile: OAuthProfile; tokens: OAuthTokens };

/**
 * What `state` carries across the consent round trip. `nonce` is the CSRF
 * check, compared against a cookie only this browser holds. `provider` stops
 * a state minted for one provider completing another's callback. `next` rides
 * along signed, so the destination cannot be edited in transit.
 */
export type OAuthState = { provider: Provider; nonce: string; next: string };

export type ExchangeDeps = { fetch: typeof fetch; now: Date };

const providers = {
  google: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
  },
  facebook: {
    authorizationUrl: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`,
    scope: "email public_profile",
  },
  instagram: {
    authorizationUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    scope: "instagram_business_basic",
  },
} satisfies Record<
  Provider,
  { authorizationUrl: string; tokenUrl: string; scope: string }
>;

export function createNonce() {
  return randomBytes(16).toString("hex");
}

/**
 * PKCE, used where the provider supports it (Google). The verifier stays in
 * an HttpOnly cookie; only its hash travels, so an intercepted authorization
 * code cannot be redeemed on its own.
 */
export function createPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function hmac(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest();
}

/** `<payload>.<signature>`, both base64url. One algorithm, never negotiated. */
export function signState(state: OAuthState, secret: string) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${hmac(secret, payload).toString("base64url")}`;
}

/** The state's contents, or null when we did not sign it. */
export function verifyState(
  token: string | null | undefined,
  secret: string,
): OAuthState | null {
  if (!token) return null;
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;

  const expected = hmac(secret, payload);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<OAuthState>;
    if (
      !parsed.provider ||
      !(parsed.provider in providers) ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.next !== "string"
    ) {
      return null;
    }
    return {
      provider: parsed.provider,
      nonce: parsed.nonce,
      next: parsed.next,
    };
  } catch {
    return null;
  }
}

export function usesPkce(provider: Provider) {
  return provider === "google";
}

export function buildAuthorizationUrl(
  client: OAuthClient,
  state: string,
  challenge: string,
) {
  const config = providers[client.provider];
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", client.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  if (client.provider === "facebook" && client.configurationId) {
    url.searchParams.set("config_id", client.configurationId);
  } else {
    url.searchParams.set("scope", config.scope);
  }

  if (usesPkce(client.provider)) {
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    // Lets someone signed into several Google accounts choose one.
    url.searchParams.set("prompt", "select_account");
  }

  return url.toString();
}

/** Redeems the authorization code and reads who signed in. */
export async function exchangeCode(
  client: OAuthClient,
  code: string,
  verifier: string | null,
  deps: ExchangeDeps,
): Promise<OAuthResult> {
  if (client.provider === "google") {
    if (!verifier) throw new OAuthError("Missing PKCE verifier.");
    return exchangeGoogle(client, code, verifier, deps);
  }
  if (client.provider === "facebook")
    return exchangeFacebook(client, code, deps);
  return exchangeInstagram(client, code, deps);
}

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
  error?: string | { message?: string };
  error_description?: string;
  error_message?: string;
};

async function readJson<T>(response: Response, what: string): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | (T & TokenPayload)
    | null;
  if (!response.ok || !payload) {
    // The provider's own description names the cause (redirect_uri mismatch,
    // an expired code) and carries no credential material.
    const error = payload?.error;
    throw new OAuthError(
      payload?.error_description ??
        payload?.error_message ??
        (typeof error === "string" ? error : error?.message) ??
        `${what} failed (${response.status}).`,
    );
  }
  return payload;
}

function toTokens(payload: TokenPayload, now: Date): OAuthTokens {
  if (!payload.access_token) {
    throw new OAuthError("The provider returned no access token.");
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: payload.expires_in
      ? Math.floor(now.getTime() / 1000) + payload.expires_in
      : null,
    tokenType: payload.token_type ?? null,
    scope: payload.scope ?? null,
    idToken: payload.id_token ?? null,
  };
}

async function exchangeGoogle(
  client: OAuthClient,
  code: string,
  verifier: string,
  deps: ExchangeDeps,
): Promise<OAuthResult> {
  const payload = await readJson<TokenPayload>(
    await deps.fetch(providers.google.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: client.redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    }),
    "Google token exchange",
  );
  if (!payload.id_token) throw new OAuthError("Google returned no ID token.");

  return {
    profile: parseGoogleIdToken(payload.id_token, client.clientId, deps.now),
    tokens: toTokens(payload, deps.now),
  };
}

const GOOGLE_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);

/**
 * Reads and checks the ID token's claims. The signature is not verified, and
 * that is safe for one reason only: this token arrived on our own TLS call to
 * Google's token endpoint, authenticated with the client secret, never through
 * the browser. Every claim that says the token is for us is still checked.
 */
export function parseGoogleIdToken(
  idToken: string,
  clientId: string,
  now: Date,
): OAuthProfile {
  let claims: Record<string, unknown>;
  try {
    const [, payload] = idToken.split(".");
    claims = JSON.parse(
      Buffer.from(payload ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    throw new OAuthError("Google returned an unreadable ID token.");
  }

  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.has(claims.iss)) {
    throw new OAuthError("ID token was not issued by Google.");
  }
  // Without this, a token Google minted for another app would be accepted.
  if (claims.aud !== clientId) {
    throw new OAuthError("ID token was issued for another application.");
  }
  if (typeof claims.exp !== "number" || now.getTime() / 1000 >= claims.exp) {
    throw new OAuthError("ID token has expired.");
  }
  if (typeof claims.sub !== "string" || !claims.sub) {
    throw new OAuthError("ID token carries no subject.");
  }
  // The address is about to be trusted enough to link an existing account,
  // and an unverified Workspace address can be set to anything.
  if (typeof claims.email !== "string" || claims.email_verified !== true) {
    throw new OAuthError("This Google account's email is not verified.");
  }

  return {
    id: claims.sub,
    email: claims.email.toLowerCase(),
    name: typeof claims.name === "string" ? claims.name.trim() || null : null,
    image: typeof claims.picture === "string" ? claims.picture : null,
  };
}

async function exchangeFacebook(
  client: OAuthClient,
  code: string,
  deps: ExchangeDeps,
): Promise<OAuthResult> {
  const tokenUrl = new URL(providers.facebook.tokenUrl);
  tokenUrl.searchParams.set("client_id", client.clientId);
  tokenUrl.searchParams.set("client_secret", client.clientSecret);
  tokenUrl.searchParams.set("redirect_uri", client.redirectUri);
  tokenUrl.searchParams.set("code", code);
  const tokens = toTokens(
    await readJson<TokenPayload>(
      await deps.fetch(tokenUrl),
      "Facebook token exchange",
    ),
    deps.now,
  );

  const profileUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me`);
  profileUrl.searchParams.set("fields", "id,name,email,picture.width(256)");
  // Accepted whether or not the app requires it, and binds the call to our
  // app secret so a leaked token alone cannot make it.
  profileUrl.searchParams.set(
    "appsecret_proof",
    createHmac("sha256", client.clientSecret)
      .update(tokens.accessToken)
      .digest("hex"),
  );
  const profile = await readJson<{
    id?: string;
    name?: string;
    email?: string;
    picture?: { data?: { url?: string; is_silhouette?: boolean } };
  }>(
    await deps.fetch(profileUrl, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    }),
    "Facebook profile",
  );
  if (!profile.id) throw new OAuthError("Facebook returned no account id.");

  return {
    profile: {
      id: profile.id,
      name: profile.name ?? null,
      // Facebook only returns a confirmed primary address, and none at all
      // when the account has no valid one.
      email: profile.email?.toLowerCase() ?? null,
      image: profile.picture?.data?.is_silhouette
        ? null
        : (profile.picture?.data?.url ?? null),
    },
    tokens,
  };
}

async function exchangeInstagram(
  client: OAuthClient,
  code: string,
  deps: ExchangeDeps,
): Promise<OAuthResult> {
  const payload = await readJson<TokenPayload & { data?: TokenPayload[] }>(
    await deps.fetch(providers.instagram.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: "authorization_code",
        redirect_uri: client.redirectUri,
        code,
      }),
    }),
    "Instagram token exchange",
  );
  // Documented as `{ data: [{ access_token, ... }] }`, served flat in practice.
  const tokens = toTokens(payload.data?.[0] ?? payload, deps.now);

  const profileUrl = new URL("https://graph.instagram.com/me");
  profileUrl.searchParams.set(
    "fields",
    "id,user_id,username,name,profile_picture_url",
  );
  profileUrl.searchParams.set("access_token", tokens.accessToken);
  const profile = await readJson<{
    id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  }>(await deps.fetch(profileUrl), "Instagram profile");
  if (!profile.id) throw new OAuthError("Instagram returned no account id.");

  return {
    profile: {
      id: profile.id,
      // `||`: an empty display name falls through to the handle.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      name: profile.name || profile.username || null,
      // Instagram never shares an email address.
      email: null,
      image: profile.profile_picture_url ?? null,
    },
    tokens,
  };
}

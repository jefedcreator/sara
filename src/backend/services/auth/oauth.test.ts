import { describe, expect, it, vi } from "vitest";

import {
  OAuthError,
  buildAuthorizationUrl,
  exchangeCode,
  parseGoogleIdToken,
  signState,
  verifyState,
  type OAuthClient,
} from "./oauth";

const SECRET = "state-secret";
const NOW = new Date("2026-09-01T12:00:00Z");

const client = (
  provider: OAuthClient["provider"],
  extra = {},
): OAuthClient => ({
  provider,
  clientId: `${provider}-id`,
  clientSecret: `${provider}-secret`,
  redirectUri: `https://sara.test/api/auth/${provider}/callback`,
  ...extra,
});

function idToken(claims: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${body}.signature`;
}

const googleClaims = {
  iss: "https://accounts.google.com",
  aud: "google-id",
  exp: NOW.getTime() / 1000 + 60,
  sub: "g-123",
  email: "Ada@Example.com",
  email_verified: true,
  name: " Ada ",
  picture: "https://img.test/a.png",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("signed state", () => {
  const state = {
    provider: "google" as const,
    nonce: "n1",
    next: "/dashboard",
  };

  it("round-trips what we signed", () => {
    expect(verifyState(signState(state, SECRET), SECRET)).toEqual(state);
  });

  it("refuses a state signed with another key", () => {
    expect(verifyState(signState(state, "other"), SECRET)).toBeNull();
  });

  it("refuses an edited payload", () => {
    const [, signature] = signState(state, SECRET).split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...state, next: "//evil.test" }),
    ).toString("base64url");
    expect(verifyState(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it("refuses malformed values", () => {
    expect(verifyState(null, SECRET)).toBeNull();
    expect(verifyState("", SECRET)).toBeNull();
    expect(verifyState("abc", SECRET)).toBeNull();
    expect(verifyState("a.b.c", SECRET)).toBeNull();
  });
});

describe("buildAuthorizationUrl", () => {
  it("sends PKCE and identity scopes to Google", () => {
    const url = new URL(buildAuthorizationUrl(client("google"), "st", "ch"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://sara.test/api/auth/google/callback",
    );
  });

  it("uses a Facebook Login for Business configuration in place of scopes", () => {
    const url = new URL(
      buildAuthorizationUrl(
        client("facebook", { configurationId: "cfg" }),
        "st",
        "ch",
      ),
    );
    expect(url.searchParams.get("config_id")).toBe("cfg");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.has("code_challenge")).toBe(false);
  });

  it("asks Instagram for the business login scope", () => {
    const url = new URL(buildAuthorizationUrl(client("instagram"), "st", "ch"));
    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic");
  });
});

describe("parseGoogleIdToken", () => {
  it("returns the subject and a lowercased verified email", () => {
    expect(parseGoogleIdToken(idToken(googleClaims), "google-id", NOW)).toEqual(
      {
        id: "g-123",
        email: "ada@example.com",
        name: "Ada",
        image: "https://img.test/a.png",
      },
    );
  });

  it.each([
    ["another app", { aud: "someone-else" }],
    ["another issuer", { iss: "https://evil.test" }],
    ["an expired token", { exp: NOW.getTime() / 1000 - 1 }],
    ["an unverified email", { email_verified: false }],
    ["no subject", { sub: "" }],
  ])("refuses %s", (_, override) => {
    expect(() =>
      parseGoogleIdToken(
        idToken({ ...googleClaims, ...override }),
        "google-id",
        NOW,
      ),
    ).toThrow(OAuthError);
  });
});

describe("exchangeCode", () => {
  it("sends the PKCE verifier to Google", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        jsonResponse({ access_token: "at", id_token: idToken(googleClaims) }),
      );
    const result = await exchangeCode(client("google"), "code", "verifier", {
      fetch,
      now: NOW,
    });
    const body = fetch.mock.calls[0]![1]!.body as URLSearchParams;
    expect(body.get("code_verifier")).toBe("verifier");
    expect(result.profile.id).toBe("g-123");
  });

  it("refuses a Google callback without a verifier", async () => {
    await expect(
      exchangeCode(client("google"), "code", null, {
        fetch: vi.fn(),
        now: NOW,
      }),
    ).rejects.toThrow(OAuthError);
  });

  it("reads the Facebook profile with an appsecret_proof", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "fb-at", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "fb-1",
          name: "Ada",
          email: "ADA@example.com",
          picture: { data: { url: "https://img.test/fb.png" } },
        }),
      );
    const result = await exchangeCode(client("facebook"), "code", null, {
      fetch,
      now: NOW,
    });
    const profileUrl = fetch.mock.calls[1]![0] as URL;
    expect(profileUrl.searchParams.get("appsecret_proof")).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(result.profile).toEqual({
      id: "fb-1",
      name: "Ada",
      email: "ada@example.com",
      image: "https://img.test/fb.png",
    });
    expect(result.tokens.expiresAt).toBe(NOW.getTime() / 1000 + 60);
  });

  it.each([
    ["flat", { access_token: "ig-at", user_id: 1 }],
    ["wrapped", { data: [{ access_token: "ig-at", user_id: 1 }] }],
  ])("accepts Instagram's %s token response", async (_, tokenBody) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(
        jsonResponse({ id: "ig-1", username: "ada.bakes" }),
      );
    const result = await exchangeCode(client("instagram"), "code", null, {
      fetch,
      now: NOW,
    });
    expect(result.tokens.accessToken).toBe("ig-at");
    expect(result.profile).toEqual({
      id: "ig-1",
      name: "ada.bakes",
      email: null,
      image: null,
    });
  });

  it("surfaces the provider's error description", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { message: "Code was already used." } }, 400),
      );
    await expect(
      exchangeCode(client("facebook"), "code", null, { fetch, now: NOW }),
    ).rejects.toThrow("Code was already used.");
  });
});

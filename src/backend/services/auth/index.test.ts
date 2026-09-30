import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/backend/services/email", () => ({
  emailService: {
    sendWelcomeEmail: vi.fn().mockResolvedValue({ success: true }),
  },
}));
vi.mock("@/env", () => ({
  env: {
    CLIENT_ID: "google-id",
    CLIENT_SECRET: "google-secret",
    FACEBOOK_CLIENT_ID: "facebook-id",
    FACEBOOK_CLIENT_SECRET: "facebook-secret",
    AUTH_SECRET: "test-auth-secret",
    NEXT_PUBLIC_APP_URL: "https://sara.test",
  },
}));

import { emailService } from "@/backend/services/email";
import { SESSION_COOKIE } from "@/server/auth/shared";

import { AuthService } from "./index";
import { OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, signState } from "./oauth";

const SECRET = "test-auth-secret";

function request(url: string, cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(url, { headers: cookie ? { cookie } : {} });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function mockPrisma() {
  return {
    account: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn(),
    },
  };
}

let prisma: ReturnType<typeof mockPrisma>;
let service: AuthService;

beforeEach(() => {
  vi.clearAllMocks();
  prisma = mockPrisma();
  service = new AuthService(prisma as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startSignIn", () => {
  it("redirects to Google with a signed state and one-shot cookies", () => {
    const response = service.startSignIn(
      request("https://sara.test/api/auth/google?next=/link?t=abc"),
      "google",
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://sara.test/api/auth/google/callback",
    );
    expect(response.cookies.get(OAUTH_STATE_COOKIE)?.value).toBeTruthy();
    expect(response.cookies.get(OAUTH_VERIFIER_COOKIE)?.value).toBeTruthy();
  });

  it("sends an unconfigured provider back to sign-in", () => {
    const response = service.startSignIn(
      request("https://sara.test/api/auth/instagram"),
      "instagram",
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("error")).toBe("unavailable");
  });
});

describe("completeSignIn", () => {
  const state = signState(
    { provider: "facebook", nonce: "nonce-1", next: "/link?t=abc" },
    SECRET,
  );
  const callback = `https://sara.test/api/auth/facebook/callback?code=c1&state=${state}`;

  it("refuses a state whose nonce this browser does not hold", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const response = await service.completeSignIn(
      request(callback, { [OAUTH_STATE_COOKIE]: "someone-elses-nonce" }),
      "facebook",
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("error")).toBe("expired");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a state minted for another provider", async () => {
    const response = await service.completeSignIn(
      request(callback.replace("/facebook/", "/google/"), {
        [OAUTH_STATE_COOKIE]: "nonce-1",
      }),
      "google",
    );
    expect(
      new URL(response.headers.get("location")!).searchParams.get("error"),
    ).toBe("expired");
  });

  it("reports a declined consent", async () => {
    const response = await service.completeSignIn(
      request(
        `https://sara.test/api/auth/facebook/callback?error=access_denied&state=${state}`,
        { [OAUTH_STATE_COOKIE]: "nonce-1" },
      ),
      "facebook",
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("declined");
    expect(location.searchParams.get("next")).toBe("/link?t=abc");
  });

  it("signs the user in and returns them to where they were going", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: "fb-at" }))
        .mockResolvedValueOnce(jsonResponse({ id: "fb-1", name: "Ada" })),
    );
    prisma.account.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: "user_1" });
    prisma.session.create.mockResolvedValue({ id: "session_1" });

    const response = await service.completeSignIn(
      request(callback, { [OAUTH_STATE_COOKIE]: "nonce-1" }),
      "facebook",
    );

    expect(response.headers.get("location")).toBe(
      "https://sara.test/link?t=abc",
    );
    const token = response.cookies.get(SESSION_COOKIE)?.value;
    expect(token).toBeTruthy();
    expect(response.cookies.get(OAUTH_STATE_COOKIE)?.value).toBe("");

    // The cookie it set is one the API accepts.
    const claim = await service.readClaim(
      request("https://sara.test/api/dashboard", { [SESSION_COOKIE]: token! }),
    );
    expect(claim).toEqual({ userId: "user_1", sessionId: "session_1" });
  });
});

describe("signInWithOAuth", () => {
  const result = {
    profile: { id: "fb-1", name: "Ada", email: "ada@example.com", image: null },
    tokens: {
      accessToken: "at",
      refreshToken: null,
      expiresAt: null,
      tokenType: null,
      scope: null,
      idToken: null,
    },
  };

  it("signs a known provider account into its user", async () => {
    prisma.account.findUnique.mockResolvedValue({
      id: "acc_1",
      userId: "user_1",
      user: { name: "Ada L.", image: null },
    });
    await service.signInWithOAuth("facebook", result);
    expect(prisma.user.update.mock.calls[0]![0]).toMatchObject({
      where: { id: "user_1" },
      data: { name: "Ada L.", provider: "facebook" },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("links a new provider to the owner with the same verified email", async () => {
    prisma.account.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: "user_2",
      name: "Ada",
      image: null,
      emailVerified: null,
    });
    await service.signInWithOAuth("facebook", result);
    const update = prisma.user.update.mock.calls[0]![0] as {
      where: unknown;
      data: { accounts: { create: { providerAccountId: string } } };
    };
    expect(update.where).toEqual({ id: "user_2" });
    expect(update.data.accounts.create.providerAccountId).toBe("fb-1");
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("welcomes someone new at their verified address", async () => {
    prisma.account.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: "user_3",
      name: "Ada",
      email: "ada@example.com",
    });
    await service.signInWithOAuth("facebook", result);
    expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith({
      to: "ada@example.com",
      name: "Ada",
    });
  });

  it("doesn't welcome a returning owner", async () => {
    prisma.account.findUnique.mockResolvedValue({
      id: "acc_1",
      userId: "user_1",
      user: { name: "Ada", image: null },
    });
    await service.signInWithOAuth("facebook", result);
    expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it("creates an Instagram owner without an email, and sends nothing", async () => {
    prisma.account.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: "user_4",
      name: "Ada",
      email: null,
    });
    await service.signInWithOAuth("instagram", {
      ...result,
      profile: { ...result.profile, email: null },
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    const create = prisma.user.create.mock.calls[0]![0] as { data: unknown };
    expect(create.data).toMatchObject({
      email: null,
      emailVerified: null,
      provider: "instagram",
    });
    expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});

describe("findLiveSession", () => {
  const claim = { userId: "user_1", sessionId: "session_1" };

  it("refuses a session that belongs to someone else", async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: "session_1",
      userId: "user_2",
      expires: new Date(Date.now() + 60_000),
    });
    expect(await service.findLiveSession(claim)).toBeNull();
  });

  it("refuses and cleans up an expired session", async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: "session_1",
      userId: "user_1",
      expires: new Date(Date.now() - 1),
    });
    expect(await service.findLiveSession(claim)).toBeNull();
    expect(prisma.session.delete).toHaveBeenCalledWith({
      where: { id: "session_1" },
    });
  });
});

describe("signOut", () => {
  it("deletes the session the cookie names", async () => {
    prisma.session.create.mockResolvedValue({ id: "session_9" });
    const token = await service.issueSession("user_9");

    await service.signOut(
      request("https://sara.test/api/auth/logout", { [SESSION_COOKIE]: token }),
    );

    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { id: "session_9", userId: "user_9" },
    });
  });
});

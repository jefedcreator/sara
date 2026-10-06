import { beforeEach, describe, expect, it, vi } from "vitest";

const env: Record<string, string | undefined> = vi.hoisted(() => ({}));
vi.mock("@/env", () => ({ env }));

import { appBaseUrl, publicUrl } from "./url";

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
});

describe("url helpers", () => {
  it("strips a trailing slash from the base url", () => {
    env.NEXT_PUBLIC_APP_URL = "https://app.sara.ng/";
    expect(appBaseUrl()).toBe("https://app.sara.ng");
  });

  it("builds a public url from a path and slug", () => {
    env.NEXT_PUBLIC_APP_URL = "https://app.sara.ng";
    expect(publicUrl("book", "acme-haircut")).toBe(
      "https://app.sara.ng/book/acme-haircut",
    );
  });

  it("falls back to Auth.js's URL, then the request, then localhost", () => {
    env.AUTH_URL = "https://auth.sara.ng";
    expect(appBaseUrl("https://req.test")).toBe("https://auth.sara.ng");
    delete env.AUTH_URL;
    expect(appBaseUrl("https://req.test")).toBe("https://req.test");
    expect(appBaseUrl()).toBe("http://localhost:3000");
  });

  it("upgrades non-localhost http to https in production", () => {
    env.NODE_ENV = "production";
    env.NEXT_PUBLIC_APP_URL = "http://sara.84-12-92-46.sslip.io";
    expect(appBaseUrl()).toBe("https://sara.84-12-92-46.sslip.io");
  });

  it("preserves http for localhost in production", () => {
    env.NODE_ENV = "production";
    env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(appBaseUrl()).toBe("http://localhost:3000");
  });
});

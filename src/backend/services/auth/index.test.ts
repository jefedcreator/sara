import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: {} }));

import { authService } from "./index";

describe("authService.sanitizeCallbackUrl", () => {
  it("keeps same-site relative paths with their query", () => {
    expect(authService.sanitizeCallbackUrl("/link?t=abc123")).toBe(
      "/link?t=abc123",
    );
    expect(authService.sanitizeCallbackUrl("/services")).toBe("/services");
  });

  it("refuses absolute and protocol-relative urls", () => {
    expect(authService.sanitizeCallbackUrl("https://evil.test/x")).toBeNull();
    expect(authService.sanitizeCallbackUrl("//evil.test/x")).toBeNull();
    expect(authService.sanitizeCallbackUrl("/\\evil.test")).toBeNull();
  });

  it("refuses characters the URL parser strips into a host", () => {
    expect(authService.sanitizeCallbackUrl("/\t/evil.test")).toBeNull();
    expect(authService.sanitizeCallbackUrl("/\n/evil.test")).toBeNull();
    expect(authService.sanitizeCallbackUrl("/ /evil.test")).toBeNull();
  });

  it("refuses empty values", () => {
    expect(authService.sanitizeCallbackUrl(null)).toBeNull();
    expect(authService.sanitizeCallbackUrl(undefined)).toBeNull();
    expect(authService.sanitizeCallbackUrl("")).toBeNull();
  });
});

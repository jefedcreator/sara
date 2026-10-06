import { describe, expect, it } from "vitest";

import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("keeps same-site relative paths with their query", () => {
    expect(safeNextPath("/link?t=abc123")).toBe("/link?t=abc123");
    expect(safeNextPath("/services")).toBe("/services");
  });

  it("refuses absolute and protocol-relative urls", () => {
    expect(safeNextPath("https://evil.test/x")).toBe("/dashboard");
    expect(safeNextPath("//evil.test/x")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.test")).toBe("/dashboard");
  });

  it("refuses characters the URL parser strips into a host", () => {
    expect(safeNextPath("/\t/evil.test")).toBe("/dashboard");
    expect(safeNextPath("/\n/evil.test")).toBe("/dashboard");
    expect(safeNextPath("/\u0000/evil.test")).toBe("/dashboard");
    expect(safeNextPath("/ /evil.test")).toBe("/dashboard");
  });

  it("falls back on empty values", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
    expect(safeNextPath(undefined, "/onboarding")).toBe("/onboarding");
  });

  it("strips legacy OAuth fragments like #_=_ and #_", () => {
    expect(safeNextPath("/dashboard#_=_")).toBe("/dashboard");
    expect(safeNextPath("/dashboard#_")).toBe("/dashboard");
    expect(safeNextPath("/link?t=abc#_=_")).toBe("/link?t=abc");
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://app.sara.ng",
    AUTH_SECRET: "test-secret",
  },
}));

import { isShareKey, sharePath, shareUrl } from "./share";

const keyOf = (path: string) => path.split("/").at(-1)!;

describe("share links", () => {
  it("puts invoices under /i and receipts under /r, with a 16-character key", () => {
    expect(shareUrl("invoice", "acme-inv-1012")).toMatch(
      /^https:\/\/app\.sara\.ng\/i\/acme-inv-1012\/[\w-]{16}$/,
    );
    expect(sharePath("receipt", "acme-rcp-1007")).toMatch(
      /^\/r\/acme-rcp-1007\/[\w-]{16}$/,
    );
  });

  it("accepts the key it issued", () => {
    const key = keyOf(sharePath("invoice", "acme-inv-1012"));
    expect(isShareKey("invoice", "acme-inv-1012", key)).toBe(true);
  });

  it("rejects a key for another document, another kind, or a mangled key", () => {
    const key = keyOf(sharePath("invoice", "acme-inv-1012"));
    expect(isShareKey("invoice", "acme-inv-1013", key)).toBe(false);
    expect(isShareKey("receipt", "acme-inv-1012", key)).toBe(false);
    expect(isShareKey("invoice", "acme-inv-1012", key.slice(0, -1))).toBe(
      false,
    );
    expect(isShareKey("invoice", "acme-inv-1012", "")).toBe(false);
  });
});

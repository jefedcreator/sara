import { afterEach, describe, expect, it } from "vitest";
import { appBaseUrl, publicUrl } from "./url";

const original = process.env.NEXT_PUBLIC_APP_URL;
afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = original;
});

describe("url helpers", () => {
  it("strips a trailing slash from the base url", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.sara.ng/";
    expect(appBaseUrl()).toBe("https://app.sara.ng");
  });
  it("builds a public url from a path and slug", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.sara.ng";
    expect(publicUrl("book", "acme-haircut")).toBe("https://app.sara.ng/book/acme-haircut");
  });
});

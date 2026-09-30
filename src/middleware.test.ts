import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";

const session = vi.hoisted(() => ({
  current: null as { user: { sessionId: string } } | null,
}));

// Auth.js stand-in: runs the callback with whatever session the test sets.
vi.mock("next-auth", () => ({
  default: () => ({
    auth:
      (callback: (request: NextRequest & { auth: unknown }) => unknown) =>
      (request: NextRequest) =>
        callback(Object.assign(request, { auth: session.current })),
  }),
}));
vi.mock("@/server/auth/config", () => ({ authConfig: {} }));
vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://app.sara.ng" },
}));

import { middleware } from "./middleware";

const WHATSAPP = "WhatsApp/2.23.20.0 A";
const CHROME =
  "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/129.0 Safari/537.36";

function visit(path: string, userAgent: string) {
  const request = new NextRequest(`http://localhost:3000${path}`, {
    headers: { "user-agent": userAgent },
  });
  return middleware(request, {} as NextFetchEvent) as
    | Promise<Response>
    | Response;
}

beforeEach(() => {
  session.current = null;
});

describe("middleware", () => {
  it("answers a signed-out link crawler with the page's own card", async () => {
    const response = await visit("/invoices", WHATSAPP);
    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe("user-agent");
    const html = await response.text();
    expect(html).toContain('content="Invoices · Sara"');
    expect(html).toContain('content="https://app.sara.ng/invoices"');
    expect(html).toContain('content="https://app.sara.ng/api/og/invoices"');
  });

  it("still sends a signed-out person to sign in", async () => {
    const response = await visit("/invoices?page=2", CHROME);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/signin?next=%2Finvoices%3Fpage%3D2",
    );
  });

  it("lets a signed-in person through", async () => {
    session.current = { user: { sessionId: "s_1" } };
    const response = await visit("/dashboard", CHROME);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

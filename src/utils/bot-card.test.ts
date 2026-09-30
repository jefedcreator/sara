import { describe, expect, it } from "vitest";

import { isSocialBot, renderBotCardHtml } from "./bot-card";
import { destinationCard } from "./cards";

const UA = {
  whatsapp: "WhatsApp/2.23.20.0 A",
  facebook:
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  slack: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  chrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  instagramInApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.0.32.112",
};

describe("isSocialBot", () => {
  it("recognises link unfurlers", () => {
    expect(isSocialBot(UA.whatsapp)).toBe(true);
    expect(isSocialBot(UA.facebook)).toBe(true);
    expect(isSocialBot(UA.slack)).toBe(true);
  });

  it("leaves people alone, in-app browsers included", () => {
    expect(isSocialBot(UA.chrome)).toBe(false);
    expect(isSocialBot(UA.instagramInApp)).toBe(false);
    expect(isSocialBot(null)).toBe(false);
  });
});

describe("destinationCard", () => {
  it("maps owner-only paths, sub-paths and queries to their card", () => {
    expect(destinationCard("/invoices")).toBe("invoices");
    expect(destinationCard("/settings?calendar=connected")).toBe("settings");
    expect(destinationCard("/bookings/abc")).toBe("bookings");
    expect(destinationCard("/onboarding")).toBe("onboarding");
  });

  it("has no card for public paths", () => {
    expect(destinationCard("/")).toBeNull();
    expect(destinationCard("/book/acme-haircut")).toBeNull();
    expect(destinationCard("/i/acme-inv-1/key")).toBeNull();
  });
});

describe("renderBotCardHtml", () => {
  const html = renderBotCardHtml(
    "https://app.sara.ng",
    "/invoices",
    "invoices",
  );

  it("names the requested page and its card", () => {
    expect(html).toContain(
      '<meta property="og:title" content="Invoices · Sara" />',
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://app.sara.ng/invoices" />',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://app.sara.ng/api/og/invoices" />',
    );
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image" />',
    );
    expect(html).toContain(
      '<meta name="robots" content="noindex, nofollow" />',
    );
  });

  it("escapes what it puts in attributes", () => {
    const hostile = renderBotCardHtml(
      "https://app.sara.ng",
      '/invoices"><script>',
      "invoices",
    );
    expect(hostile).not.toContain("<script>");
    expect(hostile).toContain("&quot;&gt;&lt;script&gt;");
  });
});

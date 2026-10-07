import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NotFound, { metadata } from "./not-found";

describe("NotFound component", () => {
  it("exports correct metadata", () => {
    expect(metadata.title).toBe("Page Not Found · Sara");
    expect(metadata.description).toBe(
      "The link you followed could not be found on Sara.",
    );
  });

  it("renders calm 404 heading and body copy", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("This link could not be found.");
    expect(html).toContain("The page you are looking for does not exist");
  });

  it("renders navigation links to home, dashboard, and services", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/services"');
  });

  it("renders the signature chat card with 404 indicator and WhatsApp options", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("Sara WhatsApp Assistant");
    expect(html).toContain("HTTP 404");
    expect(html).toContain("Where did this page go?");
    expect(html).toContain("Return to homepage");
    expect(html).toContain("Open your dashboard");
    expect(html).toContain("Message Sara on WhatsApp");
  });

  it("renders footer brand mark and credits", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("Bookings and admin by");
    expect(html).toContain("sara");
  });
});


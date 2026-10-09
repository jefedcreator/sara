import { beforeEach, describe, expect, it, vi } from "vitest";

const env: Record<string, string | undefined> = vi.hoisted(() => ({}));
vi.mock("@/env", () => ({ env }));

import { DEFAULT_SARA_WHATSAPP_NUMBER, whatsappHref } from "./whatsapp";

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  delete process.env.NEXT_PUBLIC_SARA_WHATSAPP_NUMBER;
});

describe("whatsappHref", () => {
  it("defaults to the default Sara WhatsApp number when env is unset", () => {
    expect(whatsappHref()).toBe(
      `https://wa.me/${DEFAULT_SARA_WHATSAPP_NUMBER}?text=Hi%20Sara`,
    );
  });

  it("encodes custom initial message text", () => {
    expect(whatsappHref("menu")).toBe(
      `https://wa.me/${DEFAULT_SARA_WHATSAPP_NUMBER}?text=menu`,
    );
    expect(whatsappHref("Hi Sara, I clicked a link")).toBe(
      `https://wa.me/${DEFAULT_SARA_WHATSAPP_NUMBER}?text=Hi%20Sara%2C%20I%20clicked%20a%20link`,
    );
  });

  it("sanitizes formatted phone numbers by stripping non-digits", () => {
    env.NEXT_PUBLIC_SARA_WHATSAPP_NUMBER = "+1 (555) 655-1373";
    expect(whatsappHref()).toBe("https://wa.me/15556551373?text=Hi%20Sara");
  });

  it("uses process.env if env is unset", () => {
    process.env.NEXT_PUBLIC_SARA_WHATSAPP_NUMBER = "+1 555-655-1373";
    expect(whatsappHref()).toBe("https://wa.me/15556551373?text=Hi%20Sara");
  });
});

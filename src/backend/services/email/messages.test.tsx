import { describe, expect, it } from "vitest";

import {
  bookingCancelledEmail,
  bookingReminderEmail,
  bookingRescheduledEmail,
  invoiceEmail,
  newBookingEmail,
  receiptEmail,
  welcomeEmail,
} from "./messages";
import { renderEmail } from "./render";
import type { EmailMessage } from "./types";

const origin = "https://app.sara.ng";
const business = { name: "Acme Salon", email: "hello@acme.test" };
const at = new Date("2026-10-01T13:00:00.000Z");

async function rendered(message: EmailMessage) {
  const { html, text } = await renderEmail(message);
  // Every design-system class must have become an inline style.
  expect(html).not.toContain('class="');
  return { html, text };
}

describe("owner emails", () => {
  it("welcomes a new owner towards setup", async () => {
    const message = welcomeEmail({
      origin,
      to: "tolu@example.com",
      name: "Tolu Adeyemi",
    });
    const { html, text } = await rendered(message);
    expect(message.replyTo).toBeUndefined();
    expect(text).toContain("Hi Tolu,");
    expect(html).toContain('href="https://app.sara.ng/onboarding"');
    // The primary button in the app's green, with green-ink text.
    expect(html).toContain(
      "background-color:rgb(37,211,102);color:rgb(11,43,26)",
    );
  });

  it("tells the owner who booked, when, and what they paid", async () => {
    const message = newBookingEmail({
      origin,
      to: "owner@acme.test",
      clientName: "Ada Okafor",
      clientEmail: "ada@example.com",
      clientPhone: null,
      serviceName: "Knotless braids",
      startTime: at,
      amount: 25000,
      currency: "NGN",
    });
    expect(message.subject).toBe(
      "New booking: Ada Okafor, Knotless braids, Thu 1 Oct at 13:00",
    );
    const { text } = await rendered(message);
    expect(text).toContain("NGN 25,000");
    expect(text).toContain("ada@example.com");
    expect(text).not.toContain("Phone");
  });
});

describe("customer emails", () => {
  it("replies go to the business when it has an address, and say so", async () => {
    const withAddress = bookingReminderEmail({
      origin,
      to: "ada@example.com",
      business: {
        ...business,
        address: "12 Admiralty Way",
        city: "Lekki",
        state: " ",
      },
      serviceName: "Braids",
      startTime: at,
    });
    expect(withAddress.replyTo).toBe("hello@acme.test");
    const { text } = await rendered(withAddress);
    expect(text).toContain("12 Admiralty Way, Lekki");
    expect(text).toContain("Reply to this email");

    const without = bookingReminderEmail({
      origin,
      to: "ada@example.com",
      business: { name: "Acme Salon", email: null },
      serviceName: "Braids",
      startTime: at,
    });
    expect(without.replyTo).toBeUndefined();
    expect((await rendered(without)).text).not.toContain("Reply to this email");
  });

  it("shows the old and new time of a moved booking", async () => {
    const message = bookingRescheduledEmail({
      origin,
      to: "ada@example.com",
      business,
      serviceName: "Braids",
      previousStartTime: at,
      newStartTime: new Date("2026-10-03T10:00:00.000Z"),
    });
    const { text } = await rendered(message);
    expect(message.subject).toContain("Sat 3 Oct at 10:00");
    expect(text).toContain("Thu 1 Oct at 13:00");
  });

  it("links a cancelled booking back to its booking page", async () => {
    const message = bookingCancelledEmail({
      origin,
      to: "ada@example.com",
      business,
      serviceName: "Braids",
      serviceSlug: "acme-braids",
      startTime: at,
    });
    expect((await rendered(message)).html).toContain(
      'href="https://app.sara.ng/book/acme-braids"',
    );
  });

  it("puts what's left to pay on a part-paid invoice", async () => {
    const message = invoiceEmail({
      origin,
      to: "ada@example.com",
      business,
      customerName: "Ada",
      number: "INV-1012",
      total: "62000",
      amountPaid: "20000",
      currency: "NGN",
      dueAt: new Date("2026-10-12T00:00:00.000Z"),
      url: "https://app.sara.ng/i/acme-inv-1012/key",
    });
    expect(message.subject).toBe("Invoice INV-1012 from Acme Salon");
    const { html, text } = await rendered(message);
    expect(text).toContain("NGN 42,000 is left to pay, due 12 Oct 2026");
    expect(html).toContain('href="https://app.sara.ng/i/acme-inv-1012/key"');
  });

  it("confirms what was paid on a receipt", async () => {
    const message = receiptEmail({
      origin,
      to: "ada@example.com",
      business,
      customerName: null,
      number: "RCP-1007",
      amountPaid: "15000",
      currency: "NGN",
      issuedAt: new Date("2026-09-29T10:00:00.000Z"),
      method: "Bank transfer",
      url: "https://app.sara.ng/r/acme-rcp-1007/key",
    });
    const { text } = await rendered(message);
    expect(text).toContain("Hi,");
    expect(text).toContain("NGN 15,000");
    expect(text).toContain("Bank transfer");
  });
});

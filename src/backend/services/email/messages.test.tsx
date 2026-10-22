import { describe, expect, it } from "vitest";

import {
  bookingCancelledEmail,
  bookingConfirmedEmail,
  bookingReminderEmail,
  bookingRescheduledEmail,
  invoiceEmail,
  newBookingEmail,
  orderEmail,
  receiptEmail,
  welcomeEmail,
  type OrderEmailKind,
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
      bookingUrl: "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",
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
      bookingUrl: "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",
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
      bookingUrl: "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",
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
      url: "https://app.sara.ng/invoices/Xk39fjQ2aB7mN0pR",
    });
    expect(message.subject).toBe("Invoice INV-1012 from Acme Salon");
    const { html, text } = await rendered(message);
    expect(text).toContain("NGN 42,000 is left to pay, due 12 Oct 2026");
    expect(html).toContain('href="https://app.sara.ng/invoices/Xk39fjQ2aB7mN0pR"');
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
      url: "https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE",
    });
    const { text } = await rendered(message);
    expect(text).toContain("Hi,");
    expect(text).toContain("NGN 15,000");
    expect(text).toContain("Bank transfer");
  });
  it("describes a stay in the confirmation email", async () => {
    const message = bookingConfirmedEmail({
      origin,
      to: "bisi@example.com",
      business: { name: "Lekki Stays" },
      serviceName: "Lekki 2-bed 4B",
      startTime: new Date("2026-10-02T14:00:00.000Z"),
      duration: 1440,
      amount: 255000,
      currency: "NGN",
      receiptUrl: null,
      bookingUrl: "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",
      span: { bookingMode: "NIGHTLY", endTime: new Date("2026-10-05T12:00:00.000Z"), units: 3 },
    });
    const { text } = await rendered(message);
    expect(text).toContain("Check-in Fri 2 Oct from 14:00 · Check-out Mon 5 Oct by 12:00 · 3 nights");
    expect(text).toContain("3 nights");
  });

  it("uses the short span in a stay's reminder subject", () => {
    const message = bookingReminderEmail({
      origin,
      to: "bisi@example.com",
      business: { name: "Lekki Stays" },
      serviceName: "Lekki 2-bed 4B",
      startTime: new Date("2026-10-02T14:00:00.000Z"),
      bookingUrl: "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",
      span: { bookingMode: "NIGHTLY", endTime: new Date("2026-10-05T12:00:00.000Z"), units: 3 },
    });
    expect(message.subject).toBe("Reminder: Lekki 2-bed 4B with Lekki Stays, 2–5 Oct · 3 nights");
  });

  it("links the customer's booking page from the confirmation, reminder and move", async () => {
    const bookingUrl = "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t";
    const confirmed = await rendered(
      bookingConfirmedEmail({
        origin,
        to: "ada@example.com",
        business,
        serviceName: "Braids",
        startTime: at,
        duration: 240,
        amount: 25000,
        currency: "NGN",
        receiptUrl: "https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE",
        bookingUrl,
      }),
    );
    expect(confirmed.html).toContain(`href="${bookingUrl}"`);
    expect(confirmed.text).toContain("View your booking");
    expect(confirmed.html).toContain('href="https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE"');

    const reminder = await rendered(
      bookingReminderEmail({ origin, to: "ada@example.com", business, serviceName: "Braids", startTime: at, bookingUrl }),
    );
    expect(reminder.html).toContain(`href="${bookingUrl}"`);

    const moved = await rendered(
      bookingRescheduledEmail({
        origin,
        to: "ada@example.com",
        business,
        serviceName: "Braids",
        previousStartTime: at,
        newStartTime: new Date("2026-10-03T10:00:00.000Z"),
        bookingUrl,
      }),
    );
    expect(moved.html).toContain(`href="${bookingUrl}"`);
  });
});

describe("order emails", () => {
  const orderBase = {
    origin,
    to: "ada@example.com",
    business: { name: "Tobi Hair", email: "hello@tobihair.test" },
    orderNumber: "ORD-1022",
    lines: [
      { name: 'Frontal wig — 20"', quantity: 2, total: 62000 },
      { name: "Closure — 5x5", quantity: 1, total: 31000 },
    ],
    total: 93000,
    currency: "NGN",
    fulfilment: "PICKUP" as const,
    deliveryAddress: "4 Ozumba Mbadiwe Avenue, Victoria Island, Lagos",
    pickupAddress: "12 Admiralty Way, Lekki, Lagos",
    receiptUrl: "https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE",
    orderUrl: "https://app.sara.ng/orders/Xk39fjQ2aB7mN0pR",
  };
  const subject = (kind: OrderEmailKind, fulfilment: "DELIVERY" | "PICKUP") =>
    orderEmail({ ...orderBase, kind, fulfilment }).subject;

  it("writes a subject for every state a customer sees", () => {
    expect(subject("confirmed", "PICKUP")).toBe(
      "Your order from Tobi Hair is confirmed",
    );
    expect(subject("ready", "PICKUP")).toBe(
      "Your order from Tobi Hair is ready for pickup",
    );
    expect(subject("ready", "DELIVERY")).toBe(
      "Your order from Tobi Hair is on its way",
    );
    expect(subject("completed", "DELIVERY")).toBe(
      "Your order from Tobi Hair was delivered",
    );
    expect(subject("completed", "PICKUP")).toBe(
      "Thanks for collecting your order from Tobi Hair",
    );
    expect(subject("cancelled", "PICKUP")).toBe(
      "Your order from Tobi Hair was cancelled",
    );
  });

  it("lists the order number, lines and total in the body", async () => {
    const message = orderEmail({ ...orderBase, kind: "confirmed" });
    expect(message.replyTo).toBe("hello@tobihair.test");
    const { html, text } = await rendered(message);
    expect(text).toContain("ORD-1022");
    expect(text).toContain('2 × Frontal wig — 20"');
    expect(text).toContain("NGN 93,000");
    expect(html).toContain("2 × Frontal wig — 20&quot;");
    expect(html).toContain(`href="${orderBase.orderUrl}"`);
    expect(html).toContain(`href="${orderBase.receiptUrl}"`);
  });

  it("shows the pickup address on a ready pickup email", async () => {
    const message = orderEmail({
      ...orderBase,
      kind: "ready",
      fulfilment: "PICKUP",
    });
    const { text } = await rendered(message);
    expect(text).toContain("12 Admiralty Way, Lekki, Lagos");
  });

  it("changes the heading and lead with the order's state", async () => {
    const confirmed = await rendered(
      orderEmail({ ...orderBase, kind: "confirmed" }),
    );
    expect(confirmed.text).toContain("Your order is confirmed.");
    expect(confirmed.text).toContain(
      "We'll email you as soon as it's ready to collect.",
    );

    const collected = await rendered(
      orderEmail({ ...orderBase, kind: "completed", fulfilment: "PICKUP" }),
    );
    expect(collected.text).toContain("Thanks for collecting your order.");
    expect(collected.text).toContain(
      "Here's what you collected from Tobi Hair.",
    );

    const cancelled = await rendered(
      orderEmail({ ...orderBase, kind: "cancelled" }),
    );
    expect(cancelled.text).toContain("Your order was cancelled.");
    expect(cancelled.text).toContain("This order won't go ahead.");
  });
});

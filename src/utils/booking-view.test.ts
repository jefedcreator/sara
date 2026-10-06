import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.sara.ng" } }));

import {
  bookingDates,
  bookingMetadata,
  bookingPill,
  bookingView,
  type PublicBooking,
} from "./booking-view";

// 14:00 Lagos on Mon 12 Oct, stored as 14:00Z (wall-clock written as UTC).
const BOOKING: PublicBooking = {
  publicId: "Pq8sN1xV0kL3mA6t",
  status: "CONFIRMED",
  startTime: "2026-10-12T14:00:00.000Z",
  endTime: "2026-10-12T18:00:00.000Z",
  units: 1,
  holdExpiresAt: null,
  amount: 25000,
  currency: "NGN",
  clientName: "Ada Okafor",
  service: { slug: "acme-knotless-braids", name: "Knotless braids", bookingMode: "SLOT" },
  businessName: "Acme Salon",
  businessAddress: "12 Admiralty Way, Lekki",
  receiptPath: null,
};

describe("bookingView", () => {
  it("compares the start with Lagos wall-clock time, not UTC", () => {
    // 12:30Z is 13:30 in Lagos: still to come.
    expect(bookingView(BOOKING, new Date("2026-10-12T12:30:00.000Z"))).toBe("upcoming");
    // 13:30Z is 14:30 in Lagos: it has started.
    expect(bookingView(BOOKING, new Date("2026-10-12T13:30:00.000Z"))).toBe("past");
  });

  it("reads done and cancelled from the status", () => {
    expect(bookingView({ ...BOOKING, status: "COMPLETED" })).toBe("done");
    expect(bookingView({ ...BOOKING, status: "CANCELLED" })).toBe("cancelled");
  });

  it("holds an unpaid booking until its hold expires, then releases it", () => {
    const held = { ...BOOKING, status: "PENDING" as const, holdExpiresAt: "2026-10-06T10:30:00.000Z" };
    expect(bookingView(held, new Date("2026-10-06T10:29:59.000Z"))).toBe("held");
    expect(bookingView(held, new Date("2026-10-06T10:30:00.000Z"))).toBe("released");
  });

  it("releases an unpaid booking from before holds existed", () => {
    expect(bookingView({ ...BOOKING, status: "PENDING", holdExpiresAt: null })).toBe("released");
  });
});

describe("bookingPill", () => {
  it("says Expired, not Awaiting payment, once the hold has gone", () => {
    expect(bookingPill("released")).toEqual({ label: "Expired", tone: "muted" });
    expect(bookingPill("held")).toEqual({ label: "Awaiting payment", tone: "muted" });
    expect(bookingPill("upcoming")).toEqual({ label: "Confirmed", tone: "accent" });
  });
});

describe("bookingDates", () => {
  it("names a slot's day and time, and a stay's two days and length", () => {
    expect(bookingDates({ ...BOOKING, bookingMode: "SLOT" })).toBe("Mon 12 Oct at 14:00");
    expect(
      bookingDates({
        startTime: "2026-10-02T14:00:00.000Z",
        endTime: "2026-10-05T12:00:00.000Z",
        units: 3,
        bookingMode: "NIGHTLY",
      }),
    ).toBe("Fri 2 Oct to Mon 5 Oct, 3 nights");
  });
});

describe("bookingMetadata", () => {
  const path = "/bookings/Pq8sN1xV0kL3mA6t";

  it("previews a confirmed booking by its time, unindexed", () => {
    const metadata = bookingMetadata(BOOKING, path, new Date("2026-10-06T10:00:00.000Z"));
    expect(metadata.title).toBe("Knotless braids with Acme Salon");
    expect(metadata.description).toBe("Confirmed for Mon 12 Oct at 14:00.");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("never previews a dead booking as active", () => {
    expect(bookingMetadata({ ...BOOKING, status: "CANCELLED" }, path).description).toBe(
      "This booking is no longer active.",
    );
    expect(bookingMetadata(null, path).title).toBe("Link not found · Sara");
  });
});

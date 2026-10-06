import { describe, expect, it } from "vitest";

import { bookingIcs } from "./ics";

const SLOT = {
  publicId: "Pq8sN1xV0kL3mA6t",
  startTime: "2026-10-12T14:00:00.000Z",
  endTime: "2026-10-12T18:00:00.000Z",
  businessName: "Acme Salon",
  businessAddress: "12 Admiralty Way, Lekki",
  service: { name: "Knotless braids" },
};
const options = {
  url: "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",
  now: new Date("2026-10-06T10:15:00.000Z"),
};
const encoder = new TextEncoder();
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("bookingIcs", () => {
  it("writes one event with floating local times", () => {
    const ics = bookingIcs(SLOT, options);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("\r\nUID:Pq8sN1xV0kL3mA6t@sara\r\n");
    expect(ics).toContain("\r\nDTSTAMP:20261006T101500Z\r\n");
    // No Z: the stored digits are the Lagos time the customer was shown.
    expect(ics).toContain("\r\nDTSTART:20261012T140000\r\n");
    expect(ics).toContain("\r\nDTEND:20261012T180000\r\n");
    expect(ics).toContain("\r\nSUMMARY:Knotless braids with Acme Salon\r\n");
    expect(ics).toContain("\r\nLOCATION:12 Admiralty Way\\, Lekki\r\n");
    expect(ics).toContain("\r\nURL:https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t\r\n");
  });

  it("spans a stay from check-in to check-out", () => {
    const ics = bookingIcs(
      { ...SLOT, startTime: "2026-10-02T14:00:00.000Z", endTime: "2026-10-05T12:00:00.000Z" },
      options,
    );
    expect(ics).toContain("\r\nDTSTART:20261002T140000\r\n");
    expect(ics).toContain("\r\nDTEND:20261005T120000\r\n");
  });

  it("leaves LOCATION out when the business has no address", () => {
    expect(bookingIcs({ ...SLOT, businessAddress: null }, options)).not.toContain("LOCATION");
  });

  it("escapes commas, semicolons and backslashes in text", () => {
    const ics = bookingIcs({ ...SLOT, businessName: "Tolú's Hair, Lekki; VI \\ 2" }, options);
    expect(unfold(ics)).toContain("SUMMARY:Knotless braids with Tolú's Hair\\, Lekki\\; VI \\\\ 2\r\n");
  });

  it("folds long lines at 75 octets, counting multi-byte characters", () => {
    const name = "Tolú's Hair Studio ".repeat(8).trim();
    const ics = bookingIcs({ ...SLOT, businessName: name }, options);
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(unfold(ics)).toContain(`SUMMARY:Knotless braids with ${name}\r\n`);
  });
});

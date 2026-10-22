import { describe, expect, it } from "vitest";

import { formatClock, formatDate, orderStatusLabel } from "./labels";

describe("formatClock", () => {
  it("shows a real instant as the time in Lagos", () => {
    // 13:32Z is 14:32 in Lagos (UTC+1, no daylight saving).
    expect(formatClock("2026-10-06T13:32:00.000Z")).toBe("14:32");
    expect(formatClock("2026-10-06T23:05:00.000Z")).toBe("00:05");
  });
});

describe("formatDate", () => {
  it("writes September as Sep, like every other date in the app", () => {
    expect(formatDate("2026-09-29T10:00:00.000Z")).toBe("29 Sep 2026");
    expect(formatDate("2026-10-12T00:00:00.000Z")).toBe("12 Oct 2026");
  });
});

describe("orderStatusLabel", () => {
  it("reads a ready order by how it leaves", () => {
    expect(orderStatusLabel("READY", "PICKUP")).toBe("Ready for pickup");
    expect(orderStatusLabel("READY", "DELIVERY")).toBe("Out for delivery");
  });

  it("reads a completed order by how it left", () => {
    expect(orderStatusLabel("COMPLETED", "PICKUP")).toBe("Collected");
    expect(orderStatusLabel("COMPLETED", "DELIVERY")).toBe("Delivered");
  });

  it("names the other statuses plainly", () => {
    expect(orderStatusLabel("NEW", "PICKUP")).toBe("New");
    expect(orderStatusLabel("AWAITING_PAYMENT", "PICKUP")).toBe(
      "Awaiting payment",
    );
    expect(orderStatusLabel("CANCELLED", "PICKUP")).toBe("Cancelled");
  });
});

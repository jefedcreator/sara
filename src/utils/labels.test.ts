import { describe, expect, it } from "vitest";

import { formatClock } from "./labels";

describe("formatClock", () => {
  it("shows a real instant as the time in Lagos", () => {
    // 13:32Z is 14:32 in Lagos (UTC+1, no daylight saving).
    expect(formatClock("2026-10-06T13:32:00.000Z")).toBe("14:32");
    expect(formatClock("2026-10-06T23:05:00.000Z")).toBe("00:05");
  });
});

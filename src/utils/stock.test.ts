import { describe, expect, it } from "vitest";

import { LOW_STOCK, stockBadge } from "./stock";

describe("stockBadge", () => {
  it("counts stock above the low mark", () => {
    expect(stockBadge(true, 11)).toEqual({ label: "11 in stock", tone: "ok" });
  });

  it("calls the last three low", () => {
    expect(stockBadge(true, 3)).toEqual({ label: "3 left", tone: "low" });
    expect(LOW_STOCK).toBe(3);
  });

  it("calls an empty shelf sold out", () => {
    expect(stockBadge(true, 0)).toEqual({ label: "Sold out", tone: "out" });
  });

  it("says made to order when stock isn't tracked", () => {
    expect(stockBadge(false, 0)).toEqual({
      label: "Made to order",
      tone: "untracked",
    });
  });
});

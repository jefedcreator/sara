import { describe, expect, it } from "vitest";

import { MENU, menuNumber } from "./menu";

describe("MENU", () => {
  it("keeps the services-only menu exactly as the chat has it today", () => {
    expect(MENU.SERVICES.map((m) => m.label)).toEqual([
      "New invoice",
      "New receipt",
      "Share a service (booking link)",
      "Unpaid invoices",
      "Today's bookings",
      "Business summary",
    ]);
  });

  it("gives a products business orders to send out at 5", () => {
    expect(MENU.PRODUCTS.map((m) => m.label)).toEqual([
      "New invoice",
      "New receipt",
      "Share a link",
      "Unpaid invoices",
      "Orders to send out",
      "Business summary",
    ]);
  });

  it("gives a business that sells both seven items", () => {
    expect(MENU.BOTH).toHaveLength(7);
    expect(MENU.BOTH[2]!.label).toBe("Share a link");
  });
});

describe("menuNumber", () => {
  it("numbers actions by what the business sells", () => {
    expect(menuNumber("SERVICES", "TODAY_BOOKINGS")).toBe(5);
    expect(menuNumber("PRODUCTS", "ORDERS_TO_SEND")).toBe(5);
    expect(menuNumber("BOTH", "ORDERS_TO_SEND")).toBe(7);
    expect(menuNumber("BOTH", "SUMMARY")).toBe(6);
  });

  it("returns null for an action the business doesn't have", () => {
    expect(menuNumber("PRODUCTS", "TODAY_BOOKINGS")).toBeNull();
    expect(menuNumber("SERVICES", "ORDERS_TO_SEND")).toBeNull();
  });
});

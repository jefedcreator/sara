import { renderToStaticMarkup } from "react-dom/server";
import type { CustomerListItem } from "types";
import { describe, expect, it } from "vitest";

import { CustomerRow } from "./customer-row";

const BASE_CUSTOMER: CustomerListItem = {
  id: "cus_1",
  name: "Tolu Adeyemi",
  phone: "+2348035550142",
  email: "tolu@example.com",
  spent: 310000,
  owes: 90000,
  lastActivityAt: "2026-10-21T10:00:00.000Z",
};

describe("CustomerRow component", () => {
  it("shows what the customer spent and owes", () => {
    const html = renderToStaticMarkup(
      <CustomerRow customer={BASE_CUSTOMER} currency="NGN" />,
    );

    expect(html).toContain("Tolu Adeyemi");
    expect(html).toContain("NGN 310,000");
    expect(html).toContain("Owes NGN 90,000");
  });

  it("leaves out the owes line when nothing is owed", () => {
    const html = renderToStaticMarkup(
      <CustomerRow customer={{ ...BASE_CUSTOMER, owes: 0 }} currency="NGN" />,
    );

    expect(html).toContain("NGN 310,000");
    expect(html).not.toContain("Owes");
  });
});

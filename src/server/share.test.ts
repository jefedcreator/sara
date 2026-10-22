import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://app.sara.ng" },
}));

import { productLink, publicLink, serviceLink } from "./share";

describe("public links", () => {
  it("makes absolute links from the app's origin", () => {
    expect(publicLink("invoice", "Xk39fjQ2aB7mN0pR")).toBe(
      "https://app.sara.ng/invoices/Xk39fjQ2aB7mN0pR",
    );
    expect(publicLink("receipt", "b7T0qLm2Vn9cZ4wE")).toBe(
      "https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE",
    );
    expect(publicLink("booking", "Pq8sN1xV0kL3mA6t")).toBe(
      "https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t",
    );
    expect(publicLink("order", "Qm4rT7yW2bN8cV5x")).toBe(
      "https://app.sara.ng/orders/Qm4rT7yW2bN8cV5x",
    );
    expect(serviceLink("acme-braids")).toBe(
      "https://app.sara.ng/services/acme-braids",
    );
    expect(productLink("frontal-wig")).toBe(
      "https://app.sara.ng/products/frontal-wig",
    );
  });
});

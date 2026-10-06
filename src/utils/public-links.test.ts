import { describe, expect, it } from "vitest";

import { publicPath, servicePath } from "./public-links";

describe("public paths", () => {
  it("puts each record under the name the dashboard uses for it", () => {
    expect(publicPath("invoice", "Xk39fjQ2aB7mN0pR")).toBe("/invoices/Xk39fjQ2aB7mN0pR");
    expect(publicPath("receipt", "b7T0qLm2Vn9cZ4wE")).toBe("/receipts/b7T0qLm2Vn9cZ4wE");
    expect(publicPath("booking", "Pq8sN1xV0kL3mA6t")).toBe("/bookings/Pq8sN1xV0kL3mA6t");
    expect(servicePath("acme-braids")).toBe("/services/acme-braids");
  });

  it("keeps a path segment a single segment", () => {
    expect(publicPath("invoice", "a/b")).toBe("/invoices/a%2Fb");
    expect(servicePath("a b")).toBe("/services/a%20b");
  });
});

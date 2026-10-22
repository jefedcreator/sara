import { describe, expect, it } from "vitest";

import { productPath, publicPath, servicePath } from "./public-links";

describe("public paths", () => {
  it("puts each record under the name the dashboard uses for it", () => {
    expect(publicPath("invoice", "Xk39fjQ2aB7mN0pR")).toBe(
      "/invoices/Xk39fjQ2aB7mN0pR",
    );
    expect(publicPath("receipt", "b7T0qLm2Vn9cZ4wE")).toBe(
      "/receipts/b7T0qLm2Vn9cZ4wE",
    );
    expect(publicPath("booking", "Pq8sN1xV0kL3mA6t")).toBe(
      "/bookings/Pq8sN1xV0kL3mA6t",
    );
    expect(publicPath("order", "Qm4rT7yW2bN8cV5x")).toBe(
      "/orders/Qm4rT7yW2bN8cV5x",
    );
    expect(servicePath("acme-braids")).toBe("/services/acme-braids");
    expect(productPath("frontal-wig")).toBe("/products/frontal-wig");
  });

  it("keeps a path segment a single segment", () => {
    expect(publicPath("invoice", "a/b")).toBe("/invoices/a%2Fb");
    expect(servicePath("a b")).toBe("/services/a%20b");
    expect(productPath("a b")).toBe("/products/a%20b");
  });
});

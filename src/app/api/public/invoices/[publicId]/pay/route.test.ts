import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/services/invoice/payment", () => ({
  invoicePayments: { start: vi.fn() },
}));

import { invoicePayments } from "@/backend/services/invoice/payment";
import { BadRequestException } from "@/utils/exceptions";
import { POST } from "./route";

const mockedPayments = invoicePayments as any;

const call = (publicId = "inv_pub") =>
  POST(new Request(`http://localhost:3000/api/public/invoices/${publicId}/pay`, { method: "POST" }), {
    params: Promise.resolve({ publicId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockedPayments.start.mockResolvedValue({
    paymentUrl: "https://paystack.test/pay",
  });
});

describe("POST /api/public/invoices/[publicId]/pay", () => {
  it("returns the payment url for the invoice", async () => {
    const response = await call();

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toEqual({ paymentUrl: "https://paystack.test/pay" });
    expect(mockedPayments.start).toHaveBeenCalledWith("inv_pub");
  });

  it("passes a refusal on with its status and message", async () => {
    mockedPayments.start.mockRejectedValue(
      new BadRequestException("This invoice can't be paid online"),
    );

    const response = await call();

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.message).toBe("This invoice can't be paid online");
  });

  it("hides an unexpected failure behind a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedPayments.start.mockRejectedValue(new Error("db down"));

    const response = await call();

    expect(response.status).toBe(500);
    expect((await response.json()).message).toBe("Internal server error");
  });
});

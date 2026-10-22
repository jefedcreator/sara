import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockRequest } from "@/backend/test-utils/mock-request";

vi.mock("@/backend/services/order", () => ({
  orderService: { startCheckout: vi.fn() },
}));

import { orderService } from "@/backend/services/order";
import { ConflictException } from "@/utils/exceptions";
import { POST } from "./route";

const mockedOrder = orderService as any;

const BODY = {
  productSlug: "frontal-wig",
  optionId: "opt_1",
  quantity: 2,
  fulfilment: "DELIVERY",
  deliveryAddress: "12 Admiralty Way",
  clientName: "Tolu Adeyemi",
  clientPhone: "08035550142",
  clientEmail: "tolu@example.com",
};

function post(body: unknown) {
  return createMockRequest({
    method: "POST",
    url: "http://localhost:3000/api/public/orders",
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedOrder.startCheckout.mockResolvedValue({
    order: {
      id: "ord_1",
      slug: "tobi-hair-abc",
      publicId: "pub_1",
      status: "AWAITING_PAYMENT",
      orderNumber: null,
      total: "93000",
    },
    paymentUrl: "https://paystack.test/pay",
    paymentReference: "ref_123",
  });
});

describe("POST /api/public/orders", () => {
  it("starts a checkout and returns the payment url", async () => {
    const response = await POST(post(BODY));

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.status).toBe(201);
    expect(json.data.paymentUrl).toBe("https://paystack.test/pay");
    expect(json.data.paymentReference).toBe("ref_123");
    expect(json.data.slug).toBe("tobi-hair-abc");
    expect(json.data.orderNumber).toBeNull();
    expect(mockedOrder.startCheckout).toHaveBeenCalledWith(BODY);
  });

  it("accepts a pickup order without an address or email", async () => {
    const body = { ...BODY, fulfilment: "PICKUP" } as Record<string, unknown>;
    delete body.deliveryAddress;
    delete body.clientEmail;

    const response = await POST(post(body));

    expect(response.status).toBe(201);
    expect(mockedOrder.startCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        fulfilment: "PICKUP",
        productSlug: "frontal-wig",
        clientPhone: "08035550142",
      }),
    );
  });

  it("returns 422 when required fields are missing", async () => {
    const body = { ...BODY } as Record<string, unknown>;
    delete body.clientPhone;

    const response = await POST(post(body));

    expect(response.status).toBe(422);
    expect(mockedOrder.startCheckout).not.toHaveBeenCalled();
  });

  it("returns 422 for a bad quantity or fulfilment", async () => {
    expect((await POST(post({ ...BODY, quantity: 0 }))).status).toBe(422);
    expect(
      (await POST(post({ ...BODY, fulfilment: "COURIER" }))).status,
    ).toBe(422);
    expect(mockedOrder.startCheckout).not.toHaveBeenCalled();
  });

  it("returns 422 for an unknown field", async () => {
    const response = await POST(post({ ...BODY, surprise: true }));

    expect(response.status).toBe(422);
    expect(mockedOrder.startCheckout).not.toHaveBeenCalled();
  });

  it("maps a service error to its status code", async () => {
    mockedOrder.startCheckout.mockRejectedValue(
      new ConflictException("Only 4 left"),
    );

    const response = await POST(post(BODY));

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.message).toBe("Only 4 left");
  });
});

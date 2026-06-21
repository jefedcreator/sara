import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/services/booking", () => ({
  bookingService: { createWithPayment: vi.fn() },
}));

import { bookingService } from "@/backend/services/booking";
import { BadRequestException } from "@/utils/exceptions";
import { POST } from "./route";

const mockedBooking = bookingService as any;
beforeEach(() => vi.clearAllMocks());

function postReq(body: unknown) {
  return new Request("https://x/api/public/bookings", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const START = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const END = new Date(Date.now() + 25 * 3600 * 1000).toISOString();

describe("POST /api/public/bookings", () => {
  it("creates a booking and returns the payment url", async () => {
    mockedBooking.createWithPayment.mockResolvedValue({
      booking: { id: "bkg_1", slug: "haircut-ada-1" },
      paymentUrl: "https://paystack.test/pay",
      paymentReference: "ref_1",
    });
    const res = await POST(postReq({
      serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada",
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.paymentUrl).toBe("https://paystack.test/pay");
  });

  it("returns 422 when required fields are missing", async () => {
    const res = await POST(postReq({ serviceSlug: "haircut" }));
    expect(res.status).toBe(422);
    expect(mockedBooking.createWithPayment).not.toHaveBeenCalled();
  });

  it("maps a service error to its status code", async () => {
    mockedBooking.createWithPayment.mockRejectedValue(new BadRequestException("Slot taken"));
    const res = await POST(postReq({
      serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada",
    }));
    expect(res.status).toBe(400);
  });
});

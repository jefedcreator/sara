/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: { order: { findUnique: vi.fn() } } }));

import { db } from "@/server/db";

import { getPublicOrder } from "./order-page";

const mockedDb = db as any;

const ROW = {
  publicId: "Pq8sN1xV0kL3mA6t",
  orderNumber: "ORD-1022",
  status: "READY",
  fulfilment: "DELIVERY",
  deliveryAddress: "14 Ozumba Mbadiwe, Victoria Island",
  subtotal: 90000,
  deliveryFee: 3000,
  total: 93000,
  currency: "NGN",
  paidAt: new Date("2026-10-21T09:30:00.000Z"),
  createdAt: new Date("2026-10-21T09:20:00.000Z"),
  business: {
    name: "Tobi Hair",
    address: "12 Admiralty Way",
    city: "Lekki",
    state: "Lagos",
  },
  receipt: { publicId: "rcpt_1" },
  lines: [
    {
      // The snapshot taken at checkout; the option itself has since been removed.
      name: 'Frontal wig — 20"',
      quantity: 2,
      unitPrice: 45000,
      total: 90000,
    },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("getPublicOrder", () => {
  it("maps the order, its line snapshots and its receipt for the customer's page", async () => {
    mockedDb.order.findUnique.mockResolvedValue(ROW);

    expect(await getPublicOrder("Pq8sN1xV0kL3mA6t")).toEqual({
      publicId: "Pq8sN1xV0kL3mA6t",
      orderNumber: "ORD-1022",
      status: "READY",
      fulfilment: "DELIVERY",
      statusLabel: "Out for delivery",
      statusTone: "accent",
      businessName: "Tobi Hair",
      currency: "NGN",
      lines: [
        {
          name: 'Frontal wig — 20"',
          quantity: 2,
          unitPrice: 45000,
          total: 90000,
        },
      ],
      subtotal: 90000,
      deliveryFee: 3000,
      total: 93000,
      deliveryAddress: "14 Ozumba Mbadiwe, Victoria Island",
      pickupAddress: "12 Admiralty Way, Lekki, Lagos",
      paidAt: "2026-10-21T09:30:00.000Z",
      createdAt: "2026-10-21T09:20:00.000Z",
      receiptPath: "/receipts/rcpt_1",
    });
  });

  it("keeps each line's name after its option is removed", async () => {
    mockedDb.order.findUnique.mockResolvedValue(ROW);
    await getPublicOrder("Pq8sN1xV0kL3mA6t");

    const query = mockedDb.order.findUnique.mock.calls[0][0];
    expect(query.where).toEqual({ publicId: "Pq8sN1xV0kL3mA6t" });
    // A line keeps the name it was placed under, not a live option relation.
    expect(query.select.lines.select).toEqual({
      name: true,
      quantity: true,
      unitPrice: true,
      total: true,
    });
    expect(query.select.lines.select).not.toHaveProperty("productOption");
  });

  it("shows an unpaid checkout as awaiting payment", async () => {
    mockedDb.order.findUnique.mockResolvedValue({
      ...ROW,
      status: "AWAITING_PAYMENT",
      orderNumber: null,
      paidAt: null,
      receipt: null,
    });

    expect(await getPublicOrder("Pq8sN1xV0kL3mA6t")).toMatchObject({
      statusLabel: "Awaiting payment",
      statusTone: "muted",
      paidAt: null,
      receiptPath: null,
    });
  });

  it("has no pickup address when the business left it blank", async () => {
    mockedDb.order.findUnique.mockResolvedValue({
      ...ROW,
      business: { ...ROW.business, address: null, city: " ", state: null },
    });

    expect((await getPublicOrder("Pq8sN1xV0kL3mA6t"))?.pickupAddress).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    mockedDb.order.findUnique.mockResolvedValue(null);
    expect(await getPublicOrder("nope")).toBeNull();
  });

  it("never reads the customer's contact details", async () => {
    mockedDb.order.findUnique.mockResolvedValue(null);
    await getPublicOrder("x");

    const { select } = mockedDb.order.findUnique.mock.calls[0][0];
    expect(select).not.toHaveProperty("clientName");
    expect(select).not.toHaveProperty("clientPhone");
    expect(select).not.toHaveProperty("clientEmail");
    expect(select.business.select).not.toHaveProperty("email");
    expect(select.business.select).not.toHaveProperty("phone");
  });
});

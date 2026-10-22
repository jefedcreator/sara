import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    booking: { findMany: vi.fn(), update: vi.fn() },
    invoice: { findMany: vi.fn(), update: vi.fn() },
    receipt: { findMany: vi.fn(), update: vi.fn() },
    payment: { findMany: vi.fn(), update: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});

vi.mock("@/backend/services/customer", () => ({
  customerService: {
    resolve: vi.fn(),
    ownedBy: vi.fn(),
  },
}));

import { customerService } from "@/backend/services/customer";
import { db } from "@/server/db";

import { customerBackfill } from "./backfill";

const mockedDb = db as any;
const mockedCustomer = customerService as any;

const tables = ["booking", "invoice", "receipt", "payment"] as const;

beforeEach(() => {
  vi.resetAllMocks();
  mockedDb.$transaction.mockImplementation(
    async (cb: (tx: typeof mockedDb) => unknown) => cb(mockedDb),
  );
  mockedCustomer.resolve.mockResolvedValue({ id: "cus_1" });

  for (const table of tables) {
    mockedDb[table].findMany.mockResolvedValue([]);
    mockedDb[table].update.mockResolvedValue({});
  }
});

describe("customerBackfill.run", () => {
  it("links unlinked bookings, invoices and receipts, and leaves linked ones alone", async () => {
    mockedDb.booking.findMany.mockResolvedValueOnce([
      {
        id: "bkg_1",
        businessId: "biz_1",
        clientName: "Ada",
        clientPhone: "08035550142",
        clientEmail: null,
      },
    ]);
    mockedDb.invoice.findMany.mockResolvedValueOnce([
      {
        id: "inv_1",
        businessId: "biz_1",
        clientName: "Ada",
        clientPhone: null,
        clientEmail: "ada@example.com",
      },
    ]);
    mockedDb.receipt.findMany.mockResolvedValueOnce([
      {
        id: "rcp_1",
        businessId: "biz_1",
        name: "Ada",
        phone: null,
        email: null,
      },
    ]);

    const counts = await customerBackfill.run({ batchSize: 10 });

    expect(counts).toEqual({
      bookings: 1,
      invoices: 1,
      receipts: 1,
      payments: 0,
    });

    // Only records without a customer are ever selected, so linked rows stay
    // untouched on every run.
    expect(mockedDb.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: null }, take: 10 }),
    );
    expect(mockedDb.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: null }, take: 10 }),
    );
    expect(mockedDb.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: null }, take: 10 }),
    );

    expect(mockedDb.booking.update).toHaveBeenCalledWith({
      where: { id: "bkg_1" },
      data: { customerId: "cus_1" },
    });
    expect(mockedDb.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv_1" },
      data: { customerId: "cus_1" },
    });
    expect(mockedDb.receipt.update).toHaveBeenCalledWith({
      where: { id: "rcp_1" },
      data: { customerId: "cus_1" },
    });

    expect(mockedCustomer.resolve).toHaveBeenCalledWith(mockedDb, {
      businessId: "biz_1",
      name: "Ada",
      phone: "08035550142",
      email: null,
    });
    expect(mockedCustomer.resolve).toHaveBeenCalledWith(mockedDb, {
      businessId: "biz_1",
      name: "Ada",
      phone: null,
      email: "ada@example.com",
    });
  });

  it("gives a payment the customer of its booking or invoice", async () => {
    mockedDb.payment.findMany.mockResolvedValueOnce([
      {
        id: "pay_booking",
        businessId: "biz_1",
        clientName: "Ada",
        booking: { customerId: "cus_booking" },
        invoice: null,
      },
      {
        id: "pay_invoice",
        businessId: "biz_1",
        clientName: "Ada",
        booking: null,
        invoice: { customerId: "cus_invoice" },
      },
      {
        id: "pay_snapshot",
        businessId: "biz_1",
        clientName: "Ada",
        clientPhone: null,
        clientEmail: "ada@example.com",
        booking: null,
        invoice: null,
      },
    ]);
    mockedCustomer.resolve.mockResolvedValue({ id: "cus_own" });

    const counts = await customerBackfill.run({ batchSize: 10 });

    expect(counts.payments).toBe(3);
    expect(mockedDb.payment.update).toHaveBeenCalledWith({
      where: { id: "pay_booking" },
      data: { customerId: "cus_booking" },
    });
    expect(mockedDb.payment.update).toHaveBeenCalledWith({
      where: { id: "pay_invoice" },
      data: { customerId: "cus_invoice" },
    });
    expect(mockedDb.payment.update).toHaveBeenCalledWith({
      where: { id: "pay_snapshot" },
      data: { customerId: "cus_own" },
    });

    // Only the payment with no booking or invoice falls back to its snapshot.
    expect(mockedCustomer.resolve).toHaveBeenCalledTimes(1);
    expect(mockedCustomer.resolve).toHaveBeenCalledWith(mockedDb, {
      businessId: "biz_1",
      name: "Ada",
      phone: null,
      email: "ada@example.com",
    });
  });

  it("is safe to run twice", async () => {
    const rows: Record<(typeof tables)[number], any[]> = {
      booking: [
        {
          id: "bkg_1",
          customerId: null,
          businessId: "biz_1",
          clientName: "Ada",
          clientPhone: null,
          clientEmail: null,
        },
      ],
      invoice: [
        {
          id: "inv_1",
          customerId: null,
          businessId: "biz_1",
          clientName: "Ada",
          clientPhone: null,
          clientEmail: null,
        },
      ],
      receipt: [
        {
          id: "rcp_1",
          customerId: null,
          businessId: "biz_1",
          name: "Ada",
          phone: null,
          email: null,
        },
      ],
      payment: [
        {
          id: "pay_1",
          customerId: null,
          businessId: "biz_1",
          clientName: "Ada",
          clientPhone: null,
          clientEmail: null,
          booking: null,
          invoice: null,
        },
      ],
    };

    for (const table of tables) {
      mockedDb[table].findMany.mockImplementation(
        async ({ where, take }: any) =>
          rows[table]
            .filter((row) => (where.customerId === null ? row.customerId === null : true))
            .slice(0, take),
      );
      mockedDb[table].update.mockImplementation(async ({ where, data }: any) => {
        const row = rows[table].find((item) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      });
    }

    const first = await customerBackfill.run({ batchSize: 10 });
    const second = await customerBackfill.run({ batchSize: 10 });

    expect(first).toEqual({
      bookings: 1,
      invoices: 1,
      receipts: 1,
      payments: 1,
    });
    expect(second).toEqual({
      bookings: 0,
      invoices: 0,
      receipts: 0,
      payments: 0,
    });
    expect(mockedDb.booking.update).toHaveBeenCalledTimes(1);
    expect(mockedDb.invoice.update).toHaveBeenCalledTimes(1);
    expect(mockedDb.receipt.update).toHaveBeenCalledTimes(1);
    expect(mockedDb.payment.update).toHaveBeenCalledTimes(1);
  });
});

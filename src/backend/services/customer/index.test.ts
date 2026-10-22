import type { Customer } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@/utils/exceptions";

vi.mock("@/server/db", () => {
  const db: any = {
    customer: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    booking: { groupBy: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    invoice: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    receipt: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    payment: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    order: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});

import { db } from "@/server/db";

import { customerService } from "./index";

const mockedDb = db as any;
const CUSTOMER_DATE = new Date("2026-10-01T00:00:00.000Z");
const LATER_DATE = new Date("2026-10-10T00:00:00.000Z");

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cus_1",
    businessId: "biz_1",
    name: "Tolu Adeyemi",
    nameKey: "tolu adeyemi",
    phone: null,
    email: null,
    address: null,
    notes: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeTx() {
  return {
    customer: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.customer.findFirst.mockReset();
  mockedDb.customer.findFirst.mockResolvedValue(null);
  mockedDb.customer.findMany.mockResolvedValue([]);
  mockedDb.customer.update.mockReset();
  mockedDb.customer.update.mockImplementation(async ({ data }: any) =>
    makeCustomer(data),
  );
  mockedDb.customer.delete.mockReset();
  mockedDb.customer.delete.mockResolvedValue(makeCustomer());

  for (const delegate of [
    mockedDb.booking,
    mockedDb.invoice,
    mockedDb.receipt,
    mockedDb.payment,
    mockedDb.order,
  ]) {
    delegate.groupBy.mockResolvedValue([]);
  }
  mockedDb.order.findMany.mockResolvedValue([]);
});

describe("customerService.resolve", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    tx = makeTx();
  });

  it("matches by phone written another way", async () => {
    const existing = makeCustomer({ phone: "+2348035550142" });
    tx.customer.findUnique.mockResolvedValue(existing);

    const result = await customerService.resolve(tx, {
      businessId: "biz_1",
      name: "Tolu",
      phone: "0803 555 0142",
    });

    expect(result?.id).toBe("cus_1");
    expect(tx.customer.findUnique).toHaveBeenCalledWith({
      where: {
        businessId_phone: { businessId: "biz_1", phone: "+2348035550142" },
      },
    });
    expect(tx.customer.findMany).not.toHaveBeenCalled();
    expect(tx.customer.create).not.toHaveBeenCalled();
    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it("fills a missing email on a phone match", async () => {
    const existing = makeCustomer({ phone: "+2348035550142" });
    tx.customer.findUnique.mockResolvedValue(existing);
    tx.customer.update.mockResolvedValue(
      makeCustomer({ phone: "+2348035550142", email: "tolu@example.com" }),
    );

    const result = await customerService.resolve(tx, {
      businessId: "biz_1",
      name: "Tolu",
      phone: "08035550142",
      email: " Tolu@Example.COM ",
    });

    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: "cus_1" },
      data: { email: "tolu@example.com" },
    });
    expect(result?.email).toBe("tolu@example.com");
  });

  it("matches by email when there is no phone", async () => {
    const existing = makeCustomer({ email: "tolu@example.com" });
    tx.customer.findUnique.mockResolvedValue(existing);

    const result = await customerService.resolve(tx, {
      businessId: "biz_1",
      name: "Tolu",
      email: "TOLU@example.com",
    });

    expect(result?.id).toBe("cus_1");
    expect(tx.customer.findUnique).toHaveBeenCalledWith({
      where: {
        businessId_email: { businessId: "biz_1", email: "tolu@example.com" },
      },
    });
    expect(tx.customer.create).not.toHaveBeenCalled();
  });

  it("matches a name-only record to the one customer with that name", async () => {
    const existing = makeCustomer();
    tx.customer.findMany.mockResolvedValue([existing]);

    const result = await customerService.resolve(tx, {
      businessId: "biz_1",
      name: "  Tolu   Adeyemi ",
    });

    expect(result?.id).toBe("cus_1");
    expect(tx.customer.findMany).toHaveBeenCalledWith({
      where: { businessId: "biz_1", nameKey: "tolu adeyemi" },
      take: 2,
    });
    expect(tx.customer.create).not.toHaveBeenCalled();
  });

  it("matches the one customer with the name even when it has contact details", async () => {
    const existing = makeCustomer({
      phone: "+2348035550142",
      email: "tolu@example.com",
    });
    tx.customer.findMany.mockResolvedValue([existing]);

    const result = await customerService.resolve(tx, {
      businessId: "biz_1",
      name: "Tolu Adeyemi",
    });

    expect(result?.id).toBe("cus_1");
    expect(tx.customer.create).not.toHaveBeenCalled();
    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it("creates a new customer when two customers share the name", async () => {
    tx.customer.findMany.mockResolvedValue([
      makeCustomer({ id: "cus_1" }),
      makeCustomer({ id: "cus_2" }),
    ]);
    tx.customer.create.mockResolvedValue(makeCustomer({ id: "cus_3" }));

    const result = await customerService.resolve(tx, {
      businessId: "biz_1",
      name: "Tolu Adeyemi",
    });

    expect(result?.id).toBe("cus_3");
    expect(tx.customer.create).toHaveBeenCalledWith({
      data: {
        businessId: "biz_1",
        name: "Tolu Adeyemi",
        nameKey: "tolu adeyemi",
        phone: null,
        email: null,
        address: null,
      },
    });
  });

  it("fills the phone into the one name-only customer with that name", async () => {
    const existing = makeCustomer();
    tx.customer.findMany.mockResolvedValue([existing]);
    tx.customer.update.mockResolvedValue(
      makeCustomer({ phone: "+2348035550142" }),
    );

    const result = await customerService.resolve(tx, {
      businessId: "biz_1",
      name: "Tolu Adeyemi",
      phone: "08035550142",
    });

    expect(tx.customer.findMany).toHaveBeenCalledWith({
      where: {
        businessId: "biz_1",
        nameKey: "tolu adeyemi",
        phone: null,
        email: null,
      },
      take: 2,
    });
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: "cus_1" },
      data: { phone: "+2348035550142" },
    });
    expect(result?.phone).toBe("+2348035550142");
  });

  it("fills the email into the one name-only customer with that name", async () => {
    const existing = makeCustomer();
    tx.customer.findMany.mockResolvedValue([existing]);
    tx.customer.update.mockResolvedValue(
      makeCustomer({ email: "tolu@example.com" }),
    );

    const result = await customerService.resolve(tx, {
      businessId: "biz_1",
      name: "Tolu Adeyemi",
      email: "Tolu@Example.com",
    });

    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: "cus_1" },
      data: { email: "tolu@example.com" },
    });
    expect(result?.email).toBe("tolu@example.com");
  });

  it("creates a new customer when the name matches but the phone on file differs", async () => {
    tx.customer.create.mockResolvedValue(
      makeCustomer({ id: "cus_new", phone: "+2348035550142" }),
    );

    const result = await customerService.resolve(tx, {
      businessId: "biz_1",
      name: "Tolu Adeyemi",
      phone: "08035550142",
    });

    // Only a customer with no phone on file could be filled in; this one has
    // a different phone, so the name-only lookup returns nothing.
    expect(tx.customer.findMany).toHaveBeenCalledWith({
      where: {
        businessId: "biz_1",
        nameKey: "tolu adeyemi",
        phone: null,
        email: null,
      },
      take: 2,
    });
    expect(result?.id).toBe("cus_new");
    expect(tx.customer.create).toHaveBeenCalledWith({
      data: {
        businessId: "biz_1",
        name: "Tolu Adeyemi",
        nameKey: "tolu adeyemi",
        phone: "+2348035550142",
        email: null,
        address: null,
      },
    });
  });

  it("returns null with no name, phone or email", async () => {
    expect(
      await customerService.resolve(tx, { businessId: "biz_1" }),
    ).toBeNull();
    expect(tx.customer.findUnique).not.toHaveBeenCalled();
    expect(tx.customer.findMany).not.toHaveBeenCalled();
    expect(tx.customer.create).not.toHaveBeenCalled();
  });

  it("returns null when the details are blank or malformed", async () => {
    expect(
      await customerService.resolve(tx, {
        businessId: "biz_1",
        name: "   ",
        phone: "abc",
        email: "tolu@",
      }),
    ).toBeNull();
    expect(tx.customer.findUnique).not.toHaveBeenCalled();
    expect(tx.customer.create).not.toHaveBeenCalled();
  });

  it("uses the phone for the name when none is given", async () => {
    tx.customer.create.mockResolvedValue(
      makeCustomer({
        name: "+2348035550142",
        nameKey: "+2348035550142",
        phone: "+2348035550142",
      }),
    );

    await customerService.resolve(tx, {
      businessId: "biz_1",
      phone: "08035550142",
    });

    expect(tx.customer.create).toHaveBeenCalledWith({
      data: {
        businessId: "biz_1",
        name: "+2348035550142",
        nameKey: "+2348035550142",
        phone: "+2348035550142",
        email: null,
        address: null,
      },
    });
  });

  it("uses the email for the name when none is given", async () => {
    tx.customer.create.mockResolvedValue(
      makeCustomer({
        name: "tolu@example.com",
        nameKey: "tolu@example.com",
        email: "tolu@example.com",
      }),
    );

    await customerService.resolve(tx, {
      businessId: "biz_1",
      email: "Tolu@Example.com",
    });

    expect(tx.customer.create).toHaveBeenCalledWith({
      data: {
        businessId: "biz_1",
        name: "tolu@example.com",
        nameKey: "tolu@example.com",
        phone: null,
        email: "tolu@example.com",
        address: null,
      },
    });
  });

  it("keeps the trimmed address on a new customer", async () => {
    tx.customer.create.mockResolvedValue(makeCustomer());

    await customerService.resolve(tx, {
      businessId: "biz_1",
      name: "Tolu Adeyemi",
      address: "  12 Admiralty Way  ",
    });

    expect(tx.customer.create).toHaveBeenCalledWith({
      data: {
        businessId: "biz_1",
        name: "Tolu Adeyemi",
        nameKey: "tolu adeyemi",
        phone: null,
        email: null,
        address: "12 Admiralty Way",
      },
    });
  });

  it("returns the customer a concurrent request created after a unique conflict", async () => {
    const existing = makeCustomer({ phone: "+2348035550142" });
    tx.customer.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    tx.customer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);

    const result = await customerService.resolve(tx, {
      businessId: "biz_1",
      name: "Tolu Adeyemi",
      phone: "08035550142",
    });

    expect(result?.id).toBe("cus_1");
    expect(tx.customer.create).toHaveBeenCalledTimes(1);
    expect(tx.customer.findUnique).toHaveBeenLastCalledWith({
      where: {
        businessId_phone: { businessId: "biz_1", phone: "+2348035550142" },
      },
    });
  });

  it("finds the customer by email after a unique conflict when no phone was given", async () => {
    const existing = makeCustomer({ email: "tolu@example.com" });
    tx.customer.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    tx.customer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);

    const result = await customerService.resolve(tx, {
      businessId: "biz_1",
      email: "Tolu@Example.com",
    });

    expect(result?.id).toBe("cus_1");
    expect(tx.customer.create).toHaveBeenCalledTimes(1);
    expect(tx.customer.findUnique).toHaveBeenLastCalledWith({
      where: {
        businessId_email: { businessId: "biz_1", email: "tolu@example.com" },
      },
    });
  });

  it("rethrows an error that is not a unique conflict", async () => {
    const failure = new Error("connection lost");
    tx.customer.create.mockRejectedValue(failure);

    await expect(
      customerService.resolve(tx, {
        businessId: "biz_1",
        name: "Tolu Adeyemi",
      }),
    ).rejects.toBe(failure);
  });
});

describe("customerService.findByName", () => {
  it("returns the one customer with exactly that name", async () => {
    const tolu = makeCustomer();
    const junior = makeCustomer({
      id: "cus_2",
      name: "Tolu Adeyemi Jr",
      nameKey: "tolu adeyemi jr",
    });
    mockedDb.customer.findMany
      .mockResolvedValueOnce([tolu])
      .mockResolvedValueOnce([junior]);

    const result = await customerService.findByName("biz_1", "  tolu   ADEYEMI ");

    expect(result.exact?.id).toBe("cus_1");
    expect(result.similar.map((customer) => customer.id)).toEqual(["cus_2"]);
    expect(mockedDb.customer.findMany).toHaveBeenCalledWith({
      where: { businessId: "biz_1", nameKey: "tolu adeyemi" },
      orderBy: { createdAt: "asc" },
      take: 5,
    });
    expect(mockedDb.customer.findMany).toHaveBeenCalledWith({
      where: { businessId: "biz_1", nameKey: { startsWith: "tolu adeyemi " } },
      orderBy: { nameKey: "asc" },
      take: 5,
    });
  });

  it("finds customers whose name starts with the typed words", async () => {
    mockedDb.customer.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeCustomer({ id: "cus_1" }),
        makeCustomer({ id: "cus_2", name: "Tolu Bakare", nameKey: "tolu bakare" }),
      ]);

    const result = await customerService.findByName("biz_1", "Tolu");

    expect(result.exact).toBeNull();
    expect(result.similar.map((customer) => customer.id)).toEqual([
      "cus_1",
      "cus_2",
    ]);
    expect(mockedDb.customer.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { businessId: "biz_1", nameKey: { startsWith: "tolu " } },
      }),
    );
  });

  it("offers every customer sharing the exact name instead of picking one", async () => {
    mockedDb.customer.findMany
      .mockResolvedValueOnce([
        makeCustomer({ id: "cus_1", phone: "+2348035550142" }),
        makeCustomer({ id: "cus_2", phone: "+2348035559999" }),
      ])
      .mockResolvedValueOnce([
        makeCustomer({ id: "cus_3", name: "Tolu Adeyemi Jr", nameKey: "tolu adeyemi jr" }),
      ]);

    const result = await customerService.findByName("biz_1", "Tolu Adeyemi");

    expect(result.exact).toBeNull();
    expect(result.similar.map((customer) => customer.id)).toEqual([
      "cus_1",
      "cus_2",
      "cus_3",
    ]);
  });

  it("offers at most five customers", async () => {
    mockedDb.customer.findMany
      .mockResolvedValueOnce([
        makeCustomer({ id: "cus_1" }),
        makeCustomer({ id: "cus_2" }),
      ])
      .mockResolvedValueOnce(
        ["a", "b", "c", "d", "e"].map((suffix) =>
          makeCustomer({ id: `cus_${suffix}`, nameKey: `tolu adeyemi ${suffix}` }),
        ),
      );

    const result = await customerService.findByName("biz_1", "Tolu Adeyemi");

    expect(result.similar).toHaveLength(5);
  });

  it("looks nothing up for a blank name", async () => {
    expect(await customerService.findByName("biz_1", "   ")).toEqual({
      exact: null,
      similar: [],
    });
    expect(mockedDb.customer.findMany).not.toHaveBeenCalled();
  });
});

describe("customerService.ownedBy", () => {
  it("returns a customer the business owns", async () => {
    const tx = makeTx();
    const existing = makeCustomer();
    tx.customer.findFirst.mockResolvedValue(existing);

    const result = await customerService.ownedBy(tx, "biz_1", "cus_1");

    expect(result.id).toBe("cus_1");
    expect(tx.customer.findFirst).toHaveBeenCalledWith({
      where: { id: "cus_1", businessId: "biz_1" },
    });
  });

  it("throws when the customer belongs to another business", async () => {
    const tx = makeTx();
    tx.customer.findFirst.mockResolvedValue(null);

    await expect(
      customerService.ownedBy(tx, "biz_1", "cus_other"),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      customerService.ownedBy(tx, "biz_1", "cus_other"),
    ).rejects.toThrow("Customer not found for this business");
  });
});

describe("customerService.list", () => {
  const row = {
    id: "cus_1",
    name: "Tolu Adeyemi",
    phone: "+2348035550142",
    email: "tolu@example.com",
    createdAt: CUSTOMER_DATE,
  };

  it("counts spent as payments plus receipts without a payment", async () => {
    mockedDb.customer.findMany.mockResolvedValue([row]);
    mockedDb.payment.groupBy.mockResolvedValue([
      {
        customerId: "cus_1",
        _max: { createdAt: LATER_DATE },
        _sum: { amount: 15000 },
      },
    ]);
    mockedDb.receipt.groupBy.mockResolvedValue([
      {
        customerId: "cus_1",
        _max: { createdAt: LATER_DATE },
        _sum: { amountPaid: 5000 },
      },
    ]);

    const result = await customerService.list("biz_1", { page: 1, size: 10 });

    expect(result.data[0]).toMatchObject({
      id: "cus_1",
      spent: 20000,
      owes: 0,
      lastActivityAt: LATER_DATE.toISOString(),
    });
    expect(mockedDb.receipt.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ paymentId: null }),
      }),
    );
  });

  it("counts owes from unpaid invoices only", async () => {
    mockedDb.customer.findMany.mockResolvedValue([row]);
    mockedDb.invoice.groupBy.mockResolvedValue([
      {
        customerId: "cus_1",
        _max: { createdAt: LATER_DATE },
        _sum: { total: 50000, amountPaid: 10000 },
      },
    ]);

    const result = await customerService.list("biz_1", { page: 1, size: 10 });

    expect(result.data[0]!.owes).toBe(40000);
    expect(mockedDb.invoice.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        }),
      }),
    );
  });

  it("searches name, phone and email", async () => {
    await customerService.list("biz_1", {
      query: "0803 555",
      page: 1,
      size: 10,
    });

    expect(mockedDb.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: "biz_1",
          OR: expect.arrayContaining([
            { name: { contains: "0803 555", mode: "insensitive" } },
            { email: { contains: "0803 555", mode: "insensitive" } },
            { phone: { contains: "0803555" } },
            { phone: { contains: "803555" } },
          ]),
        }),
      }),
    );
  });

  it("sorts by the most recent activity", async () => {
    mockedDb.customer.findMany.mockResolvedValue([
      { ...row, id: "cus_old", name: "Older" },
      { ...row, id: "cus_new", name: "Newer" },
    ]);
    mockedDb.booking.groupBy.mockResolvedValue([
      { customerId: "cus_old", _max: { createdAt: LATER_DATE } },
      {
        customerId: "cus_new",
        _max: { createdAt: new Date("2026-10-12T00:00:00.000Z") },
      },
    ]);

    const result = await customerService.list("biz_1", { page: 1, size: 10 });

    expect(result.data.map((customer) => customer.id)).toEqual([
      "cus_new",
      "cus_old",
    ]);
    expect(result.total).toBe(2);
  });

  it("pages the matched customers", async () => {
    mockedDb.customer.findMany.mockResolvedValue([
      { ...row, id: "cus_1", name: "A" },
      { ...row, id: "cus_2", name: "B" },
      { ...row, id: "cus_3", name: "C" },
    ]);

    const result = await customerService.list("biz_1", { page: 2, size: 1 });

    expect(result.total).toBe(3);
    expect(result.data.map((customer) => customer.id)).toEqual(["cus_2"]);
  });

  it("counts an order as the latest activity", async () => {
    mockedDb.customer.findMany.mockResolvedValue([row]);
    mockedDb.order.groupBy.mockResolvedValue([
      { customerId: "cus_1", _max: { createdAt: LATER_DATE } },
    ]);

    const result = await customerService.list("biz_1", { page: 1, size: 10 });

    expect(result.data[0]!.lastActivityAt).toBe(LATER_DATE.toISOString());
    expect(mockedDb.order.groupBy).toHaveBeenCalledWith({
      by: ["customerId"],
      where: {
        businessId: "biz_1",
        customerId: { in: ["cus_1"] },
        status: { not: "AWAITING_PAYMENT" },
      },
      _max: { createdAt: true },
    });
  });
});

describe("customerService.detail", () => {
  const customer = makeCustomer({
    phone: "+2348035550142",
    email: "tolu@example.com",
    address: "12 Admiralty Way",
    notes: "Prefers Saturdays",
  });

  function mockHistory() {
    mockedDb.customer.findFirst.mockResolvedValue(customer);
    mockedDb.payment.aggregate.mockResolvedValue({
      _sum: { amount: 15000 },
      _max: { createdAt: new Date("2026-10-05T00:00:00.000Z") },
    });
    mockedDb.receipt.aggregate.mockResolvedValue({
      _sum: { amountPaid: 5000 },
    });
    mockedDb.invoice.aggregate.mockResolvedValue({
      _sum: { total: 50000, amountPaid: 10000 },
    });
    mockedDb.booking.findMany.mockResolvedValue([
      {
        id: "bkg_1",
        publicId: "bk_public",
        status: "CONFIRMED",
        amount: 20000,
        createdAt: new Date("2026-10-03T00:00:00.000Z"),
        service: { name: "Knotless braids" },
      },
    ]);
    mockedDb.invoice.findMany.mockResolvedValue([
      {
        id: "inv_1",
        publicId: "inv_public",
        invoiceNumber: "INV-1042",
        status: "SENT",
        total: 50000,
        createdAt: new Date("2026-10-04T00:00:00.000Z"),
      },
    ]);
    mockedDb.receipt.findMany.mockResolvedValue([
      {
        id: "rcp_1",
        publicId: "rcp_public",
        receiptNumber: "RCP-2210",
        amountPaid: 5000,
        createdAt: new Date("2026-10-06T00:00:00.000Z"),
      },
    ]);
  }

  it("lists the timeline newest first with customer links", async () => {
    mockHistory();

    const result = await customerService.detail("biz_1", "cus_1");

    expect(result.spent).toBe(20000);
    expect(result.owes).toBe(40000);
    expect(result.lastActivityAt).toBe("2026-10-06T00:00:00.000Z");
    expect(result.address).toBe("12 Admiralty Way");
    expect(result.notes).toBe("Prefers Saturdays");
    expect(result.createdAt).toBe(CUSTOMER_DATE.toISOString());
    expect(result.timeline.map((entry) => entry.kind)).toEqual([
      "receipt",
      "invoice",
      "booking",
    ]);
    expect(result.timeline[0]).toEqual({
      kind: "receipt",
      id: "rcp_1",
      label: "Receipt RCP-2210",
      amount: 5000,
      status: "PAID",
      at: "2026-10-06T00:00:00.000Z",
      href: "/receipts/rcp_public",
    });
    expect(result.timeline[1]!.href).toBe("/invoices/inv_public");
    expect(result.timeline[2]).toMatchObject({
      label: "Booking · Knotless braids",
      href: "/bookings/bk_public",
    });
  });

  it("adds orders to the customer's timeline", async () => {
    mockHistory();
    mockedDb.order.findMany.mockResolvedValue([
      {
        id: "ord_1",
        publicId: "ord_pub",
        orderNumber: "ORD-1022",
        status: "READY",
        total: 93000,
        createdAt: new Date("2026-10-07T00:00:00.000Z"),
      },
    ]);

    const result = await customerService.detail("biz_1", "cus_1");

    expect(result.timeline[0]).toEqual({
      kind: "order",
      id: "ord_1",
      label: "Order ORD-1022",
      amount: 93000,
      status: "READY",
      at: "2026-10-07T00:00:00.000Z",
      href: "/orders/ord_pub",
    });
    expect(result.lastActivityAt).toBe("2026-10-07T00:00:00.000Z");
    expect(mockedDb.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId: "biz_1",
          customerId: "cus_1",
          status: { not: "AWAITING_PAYMENT" },
        },
      }),
    );
  });

  it("returns 404 for a customer of another business", async () => {
    mockedDb.customer.findFirst.mockResolvedValue(null);

    await expect(
      customerService.detail("biz_1", "cus_other"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("customerService.update", () => {
  it("normalises the name, phone and email it changes", async () => {
    mockedDb.customer.findFirst.mockResolvedValue(makeCustomer());

    await customerService.update("biz_1", "cus_1", {
      name: "  Tolu A.  ",
      phone: "0803 555 0142",
      email: " Tolu@Example.COM ",
    });

    expect(mockedDb.customer.update).toHaveBeenCalledWith({
      where: { id: "cus_1" },
      data: {
        name: "Tolu A.",
        nameKey: "tolu a.",
        phone: "+2348035550142",
        email: "tolu@example.com",
      },
    });
  });

  it("refuses a phone another customer already has", async () => {
    mockedDb.customer.findFirst.mockResolvedValue(makeCustomer());
    mockedDb.customer.update.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["businessId", "phone"] },
      }),
    );

    await expect(
      customerService.update("biz_1", "cus_1", { phone: "08035550142" }),
    ).rejects.toThrow("Another customer already has this phone number");
  });

  it("names the email when the email is the duplicate", async () => {
    mockedDb.customer.findFirst.mockResolvedValue(makeCustomer());
    mockedDb.customer.update.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["businessId", "email"] },
      }),
    );

    await expect(
      customerService.update("biz_1", "cus_1", {
        email: "tolu@example.com",
      }),
    ).rejects.toThrow("Another customer already has this email address");
  });

  it("throws a ConflictException", async () => {
    mockedDb.customer.findFirst.mockResolvedValue(makeCustomer());
    mockedDb.customer.update.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    await expect(
      customerService.update("biz_1", "cus_1", { phone: "08035550142" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("customerService.merge", () => {
  const keep = makeCustomer({
    id: "cus_keep",
    phone: "+2348035550142",
    email: "tolu@example.com",
    address: "12 Admiralty Way",
    notes: "Prefers Saturdays",
  });
  const merged = makeCustomer({
    id: "cus_merge",
    name: "Tolu A.",
    phone: "+2348035559999",
    email: "other@example.com",
  });

  it("moves every record to the kept customer, then deletes the other", async () => {
    mockedDb.customer.findFirst
      .mockResolvedValueOnce(keep)
      .mockResolvedValueOnce(merged);

    const result = await customerService.merge(
      "biz_1",
      "cus_keep",
      "cus_merge",
    );

    expect(result.id).toBe("cus_keep");
    for (const delegate of [
      mockedDb.booking,
      mockedDb.invoice,
      mockedDb.receipt,
      mockedDb.payment,
      mockedDb.order,
    ]) {
      expect(delegate.updateMany).toHaveBeenCalledWith({
        where: { customerId: "cus_merge" },
        data: { customerId: "cus_keep" },
      });
    }
    expect(mockedDb.customer.delete).toHaveBeenCalledWith({
      where: { id: "cus_merge" },
    });
    expect(mockedDb.customer.update).not.toHaveBeenCalled();

    const movedAt = Math.min(
      ...mockedDb.booking.updateMany.mock.invocationCallOrder,
      ...mockedDb.invoice.updateMany.mock.invocationCallOrder,
      ...mockedDb.receipt.updateMany.mock.invocationCallOrder,
      ...mockedDb.payment.updateMany.mock.invocationCallOrder,
      ...mockedDb.order.updateMany.mock.invocationCallOrder,
    );
    expect(
      mockedDb.customer.delete.mock.invocationCallOrder[0],
    ).toBeGreaterThan(movedAt);
  });

  it("fills the kept customer's missing phone from the merged one", async () => {
    const keepWithoutPhone = makeCustomer({
      id: "cus_keep",
      phone: null,
      email: "tolu@example.com",
    });
    mockedDb.customer.findFirst
      .mockResolvedValueOnce(keepWithoutPhone)
      .mockResolvedValueOnce(merged);

    await customerService.merge("biz_1", "cus_keep", "cus_merge");

    expect(mockedDb.customer.update).toHaveBeenCalledWith({
      where: { id: "cus_keep" },
      data: { phone: "+2348035559999" },
    });
    // The merged row is gone before its unique phone moves to the keeper.
    expect(mockedDb.customer.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mockedDb.customer.update.mock.invocationCallOrder[0]!,
    );
  });

  it("refuses to merge a customer with itself", async () => {
    await expect(
      customerService.merge("biz_1", "cus_1", "cus_1"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a customer of another business", async () => {
    mockedDb.customer.findFirst
      .mockResolvedValueOnce(keep)
      .mockResolvedValueOnce(null);

    await expect(
      customerService.merge("biz_1", "cus_keep", "cus_other"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockedDb.customer.delete).not.toHaveBeenCalled();
  });
});

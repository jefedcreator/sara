import { Prisma, type Product, type ProductOption } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestException, NotFoundException } from "@/utils/exceptions";

vi.mock("@/server/db", () => {
  const db: any = {
    product: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    productOption: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };
  return { db };
});

import { db } from "@/server/db";

import { productService } from "./index";

const mockedDb = db as any;
const NOW = new Date("2026-10-21T12:00:00.000Z");

function makeOption(overrides: Partial<ProductOption> = {}): ProductOption {
  return {
    id: "opt_1",
    productId: "prd_1",
    name: '20"',
    price: null,
    stock: 6,
    position: 0,
    isActive: true,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "prd_1",
    slug: "frontal-wig",
    businessId: "biz_1",
    name: "Frontal wig",
    description: null,
    price: new Prisma.Decimal("45000"),
    photos: [],
    tracksStock: true,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeProductWithOptions(
  options: ProductOption[] = [makeOption()],
  overrides: Partial<Product> = {},
) {
  return { ...makeProduct(overrides), options };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Frontal wig",
    price: 45000,
    tracksStock: true,
    options: [{ name: '20"', stock: 6 }],
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedDb.product.findUnique.mockResolvedValue(null);
  mockedDb.product.findFirst.mockResolvedValue(null);
  mockedDb.product.findMany.mockResolvedValue([]);
  mockedDb.product.create.mockResolvedValue(makeProductWithOptions());
  mockedDb.product.update.mockResolvedValue(makeProductWithOptions());
  mockedDb.productOption.findFirst.mockResolvedValue(null);
  mockedDb.productOption.update.mockImplementation(async ({ data }: any) => ({
    ...makeOption(),
    ...data,
  }));
});

describe("productService.create", () => {
  it("creates a product with its options in order and a slug from the name", async () => {
    const result = await productService.create(
      "biz_1",
      makeInput({
        options: [
          { name: '20"', stock: 6 },
          { name: '22"', price: 48000, stock: 2 },
          { name: '24"', stock: 0 },
        ],
      }),
      ["https://cdn.test/1.jpg"],
    );

    const call = mockedDb.product.create.mock.calls[0]![0];
    expect(call.data).toMatchObject({
      businessId: "biz_1",
      slug: "frontal-wig",
      name: "Frontal wig",
      description: null,
      price: 45000,
      photos: ["https://cdn.test/1.jpg"],
      tracksStock: true,
    });
    expect(call.data.options.create).toEqual([
      { name: '20"', price: null, stock: 6, position: 0 },
      { name: '22"', price: 48000, stock: 2, position: 1 },
      { name: '24"', price: null, stock: 0, position: 2 },
    ]);
    expect(call.include).toEqual({
      options: { where: { isActive: true }, orderBy: { position: "asc" } },
    });
    expect(result.slug).toBe("frontal-wig");
  });

  it("adds a suffix when the slug is taken", async () => {
    mockedDb.product.findUnique
      .mockResolvedValueOnce(makeProduct())
      .mockResolvedValueOnce(null);

    await productService.create("biz_1", makeInput(), []);

    const call = mockedDb.product.create.mock.calls[0]![0];
    expect(call.data.slug).toMatch(/^frontal-wig-/);
    expect(call.data.slug).not.toBe("frontal-wig");
    expect(mockedDb.product.findUnique).toHaveBeenCalledTimes(2);
  });

  it("refuses more than 5 photos", async () => {
    await expect(
      productService.create("biz_1", makeInput(), [
        "1.jpg",
        "2.jpg",
        "3.jpg",
        "4.jpg",
        "5.jpg",
        "6.jpg",
      ]),
    ).rejects.toThrow("A product can have up to 5 photos");
    expect(mockedDb.product.create).not.toHaveBeenCalled();
  });

  it("refuses two options with the same name, ignoring case", async () => {
    await expect(
      productService.create(
        "biz_1",
        makeInput({
          options: [
            { name: "Red", stock: 1 },
            { name: "red", stock: 1 },
          ],
        }),
        [],
      ),
    ).rejects.toThrow("Each option needs a different name");
    expect(mockedDb.product.create).not.toHaveBeenCalled();
  });

  it("refuses an unnamed option next to named ones", async () => {
    await expect(
      productService.create(
        "biz_1",
        makeInput({
          options: [
            { name: "", stock: 0 },
            { name: '20"', stock: 1 },
          ],
        }),
        [],
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockedDb.product.create).not.toHaveBeenCalled();
  });

  it("allows a single unnamed option", async () => {
    await productService.create(
      "biz_1",
      makeInput({ options: [{ name: "", stock: 0 }] }),
      [],
    );

    const call = mockedDb.product.create.mock.calls[0]![0];
    expect(call.data.options.create).toEqual([
      { name: "", price: null, stock: 0, position: 0 },
    ]);
  });

  it("needs at least one option", async () => {
    await expect(
      productService.create("biz_1", makeInput({ options: [] }), []),
    ).rejects.toThrow("A product needs at least one option");
  });
});

describe("productService.update", () => {
  it("deactivates options missing from an update instead of deleting them", async () => {
    mockedDb.product.findFirst.mockResolvedValue({
      ...makeProduct(),
      options: [{ id: "opt_1" }, { id: "opt_2" }],
    });

    await productService.update("biz_1", "frontal-wig", {
      options: [{ id: "opt_1", name: '20"', stock: 6 }],
    });

    const call = mockedDb.product.update.mock.calls[0]![0];
    expect(call.data.options.update).toEqual([
      {
        where: { id: "opt_1" },
        data: {
          name: '20"',
          price: null,
          stock: 6,
          position: 0,
          isActive: true,
        },
      },
    ]);
    expect(call.data.options.create).toEqual([]);
    expect(call.data.options.updateMany).toEqual({
      where: { id: { notIn: ["opt_1"] } },
      data: { isActive: false },
    });
  });

  it("creates options that arrive without an id", async () => {
    mockedDb.product.findFirst.mockResolvedValue({
      ...makeProduct(),
      options: [{ id: "opt_1" }],
    });

    await productService.update("biz_1", "frontal-wig", {
      options: [
        { id: "opt_1", name: '20"', stock: 6 },
        { name: '22"', price: 48000, stock: 2 },
      ],
    });

    const call = mockedDb.product.update.mock.calls[0]![0];
    expect(call.data.options.create).toEqual([
      {
        name: '22"',
        price: 48000,
        stock: 2,
        position: 1,
        isActive: true,
      },
    ]);
    expect(call.data.options.updateMany).toEqual({
      where: { id: { notIn: ["opt_1"] } },
      data: { isActive: false },
    });
  });

  it("refuses an option id that belongs to another product", async () => {
    mockedDb.product.findFirst.mockResolvedValue({
      ...makeProduct(),
      options: [{ id: "opt_1" }],
    });

    await expect(
      productService.update("biz_1", "frontal-wig", {
        options: [{ id: "opt_other", name: '20"', stock: 6 }],
      }),
    ).rejects.toThrow("Option not found on this product");
  });

  it("returns 404 for a product of another business", async () => {
    mockedDb.product.findFirst.mockResolvedValue(null);

    await expect(
      productService.update("biz_2", "frontal-wig", { isActive: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockedDb.product.update).not.toHaveBeenCalled();
  });
});

describe("productService.list", () => {
  it("lists active products by default and can include paused ones", async () => {
    await productService.list("biz_1");
    expect(mockedDb.product.findMany.mock.calls[0]![0].where).toEqual({
      businessId: "biz_1",
      isActive: true,
    });

    await productService.list("biz_1", { includeInactive: true });
    expect(mockedDb.product.findMany.mock.calls[1]![0].where).toEqual({
      businessId: "biz_1",
    });
  });
});

describe("productService.getBySlug", () => {
  it("returns 404 for a product of another business", async () => {
    mockedDb.product.findFirst.mockResolvedValue(null);

    await expect(
      productService.getBySlug("biz_2", "frontal-wig"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockedDb.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: "frontal-wig", businessId: "biz_2" },
      }),
    );
  });
});

describe("productService.adjustStock", () => {
  it("adds stock and sets stock", async () => {
    mockedDb.productOption.findFirst.mockResolvedValue({
      ...makeOption({ stock: 6 }),
      product: { tracksStock: true },
    });

    const added = await productService.adjustStock("biz_1", "opt_1", {
      add: 5,
    });
    expect(added.stock).toBe(11);

    const set = await productService.adjustStock("biz_1", "opt_1", { set: 2 });
    expect(set.stock).toBe(2);
  });

  it("refuses stock below zero", async () => {
    mockedDb.productOption.findFirst.mockResolvedValue({
      ...makeOption({ stock: 6 }),
      product: { tracksStock: true },
    });

    await expect(
      productService.adjustStock("biz_1", "opt_1", { add: -7 }),
    ).rejects.toThrow("Stock can't go below zero");
    expect(mockedDb.productOption.update).not.toHaveBeenCalled();
  });

  it("refuses a stock change on a product that doesn't track stock", async () => {
    mockedDb.productOption.findFirst.mockResolvedValue({
      ...makeOption({ stock: 6 }),
      product: { tracksStock: false },
    });

    await expect(
      productService.adjustStock("biz_1", "opt_1", { add: 1 }),
    ).rejects.toThrow("This product doesn't track stock");
    expect(mockedDb.productOption.update).not.toHaveBeenCalled();
  });

  it("returns 404 for an option of another business", async () => {
    mockedDb.productOption.findFirst.mockResolvedValue(null);

    await expect(
      productService.adjustStock("biz_2", "opt_1", { add: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

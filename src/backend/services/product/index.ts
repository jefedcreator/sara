import type { Prisma, Product, ProductOption } from "@prisma/client";
import slugify from "slugify";

import { MAX_PHOTOS } from "@/backend/validators/product.validator";
import { db } from "@/server/db";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";

export type ProductOptionInput = {
  id?: string;
  name: string;
  price?: number | null;
  stock: number;
};

export type ProductInput = {
  name: string;
  description?: string | null;
  price: number;
  tracksStock: boolean;
  options: ProductOptionInput[];
};

export type ProductWithOptions = Product & { options: ProductOption[] };

export type ProductUpdateInput = Partial<ProductInput> & {
  isActive?: boolean;
  photos?: string[];
};

export type StockChange = { add: number } | { set: number };

const MAX_OPTIONS = 20;
const MAX_NAME_LENGTH = 255;

type NormalisedOption = {
  id?: string;
  name: string;
  price: number | null;
  stock: number;
};

/** Active options in the order the owner arranged them. */
const activeOptions = {
  options: {
    where: { isActive: true },
    orderBy: { position: "asc" },
  },
} satisfies Prisma.ProductInclude;

function validateName(name: string): string {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    throw new BadRequestException("A product needs a name");
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new BadRequestException(
      `A product name can be up to ${MAX_NAME_LENGTH} characters`,
    );
  }

  return trimmed;
}

function validatePrice(price: number, label = "Price"): number {
  if (!Number.isFinite(price) || price < 0) {
    throw new BadRequestException(`${label} can't be negative`);
  }

  return price;
}

function validateStock(stock: number): number {
  if (!Number.isInteger(stock) || stock < 0) {
    throw new BadRequestException("Stock can't go below zero");
  }

  return stock;
}

function validatePhotos(photos: string[]): string[] {
  if (photos.length > MAX_PHOTOS) {
    throw new BadRequestException(
      `A product can have up to ${MAX_PHOTOS} photos`,
    );
  }

  return photos;
}

/**
 * Trim option names, check the product's stock and price rules, and number
 * them later by array order. An empty name only makes sense when the product
 * has exactly one option, the unnamed default.
 */
function normaliseOptions(options: ProductOptionInput[]): NormalisedOption[] {
  if (options.length === 0) {
    throw new BadRequestException("A product needs at least one option");
  }
  if (options.length > MAX_OPTIONS) {
    throw new BadRequestException(
      `A product can have up to ${MAX_OPTIONS} options`,
    );
  }

  const normalised = options.map((option) => {
    if (option.price !== undefined && option.price !== null) {
      validatePrice(option.price, "Option price");
    }

    return {
      id: option.id,
      name: option.name.trim(),
      price: option.price ?? null,
      stock: validateStock(option.stock),
    };
  });

  if (normalised.length > 1 && normalised.some((option) => !option.name)) {
    throw new BadRequestException(
      "Name each option when a product has more than one",
    );
  }

  const names = new Set<string>();
  for (const option of normalised) {
    if (!option.name) continue;

    const key = option.name.toLowerCase();
    if (names.has(key)) {
      throw new BadRequestException("Each option needs a different name");
    }
    names.add(key);
  }

  return normalised;
}

/** Turn a product name into a slug no other product already uses. */
async function uniqueSlug(name: string): Promise<string> {
  let slug = slugify(name, { lower: true, strict: true }) || "product";
  let isUnique = false;
  let attempts = 0;

  while (!isUnique && attempts < 10) {
    const existing = await db.product.findUnique({ where: { slug } });

    if (!existing) {
      isUnique = true;
    } else {
      slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
      attempts++;
    }
  }

  return slug;
}

class ProductService {
  async create(
    businessId: string,
    input: ProductInput,
    photos: string[],
  ): Promise<ProductWithOptions> {
    const name = validateName(input.name);
    validatePrice(input.price);
    validatePhotos(photos);
    const options = normaliseOptions(input.options);
    const slug = await uniqueSlug(name);

    return db.product.create({
      data: {
        businessId,
        slug,
        name,
        // `||`: a blank description counts as none.
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        description: input.description?.trim() || null,
        price: input.price,
        photos,
        tracksStock: input.tracksStock,
        options: {
          create: options.map((option, position) => ({
            name: option.name,
            price: option.price,
            stock: option.stock,
            position,
          })),
        },
      },
      include: activeOptions,
    });
  }

  /**
   * Edit a product. Options in the patch are updated (by id) or created, and
   * every option the patch leaves out is deactivated instead of deleted, so
   * past orders keep pointing at it.
   */
  async update(
    businessId: string,
    slug: string,
    patch: ProductUpdateInput,
  ): Promise<ProductWithOptions> {
    const product = await db.product.findFirst({
      where: { slug, businessId },
      include: { options: { select: { id: true } } },
    });

    if (!product) {
      throw new NotFoundException("Product not found");
    }

    const data: Prisma.ProductUpdateInput = {};

    if (patch.name !== undefined) data.name = validateName(patch.name);
    if (patch.description !== undefined) {
      // `||`: a blank description clears it.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      data.description = patch.description?.trim() || null;
    }
    if (patch.price !== undefined) {
      data.price = validatePrice(patch.price);
    }
    if (patch.tracksStock !== undefined) data.tracksStock = patch.tracksStock;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    if (patch.photos !== undefined) data.photos = validatePhotos(patch.photos);

    if (patch.options !== undefined) {
      const options = normaliseOptions(patch.options);
      const existingIds = new Set(product.options.map((option) => option.id));

      for (const option of options) {
        if (option.id && !existingIds.has(option.id)) {
          throw new BadRequestException("Option not found on this product");
        }
      }

      const optionUpdates: Prisma.ProductOptionUpdateWithWhereUniqueWithoutProductInput[] =
        [];
      const optionCreates: Prisma.ProductOptionCreateWithoutProductInput[] = [];
      const keptIds: string[] = [];

      options.forEach((option, position) => {
        const optionData = {
          name: option.name,
          price: option.price,
          stock: option.stock,
          position,
          isActive: true,
        };

        if (option.id) {
          keptIds.push(option.id);
          optionUpdates.push({ where: { id: option.id }, data: optionData });
        } else {
          optionCreates.push(optionData);
        }
      });

      data.options = {
        update: optionUpdates,
        create: optionCreates,
        updateMany: {
          where: { id: { notIn: keptIds } },
          data: { isActive: false },
        },
      };
    }

    return db.product.update({
      where: { id: product.id },
      data,
      include: activeOptions,
    });
  }

  async list(
    businessId: string,
    opts: { includeInactive?: boolean } = {},
  ): Promise<ProductWithOptions[]> {
    return db.product.findMany({
      where: {
        businessId,
        ...(opts.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { createdAt: "desc" },
      include: activeOptions,
    });
  }

  async getBySlug(
    businessId: string,
    slug: string,
  ): Promise<ProductWithOptions> {
    const product = await db.product.findFirst({
      where: { slug, businessId },
      include: activeOptions,
    });

    if (!product) {
      throw new NotFoundException("Product not found");
    }

    return product;
  }

  /**
   * Change one option's stock by a delta or to an exact value. Stock never
   * goes below zero, and products that don't track stock have no stock to
   * change.
   */
  async adjustStock(
    businessId: string,
    optionId: string,
    change: StockChange,
  ): Promise<ProductOption> {
    const option = await db.productOption.findFirst({
      where: { id: optionId, product: { businessId } },
      include: { product: { select: { tracksStock: true } } },
    });

    if (!option) {
      throw new NotFoundException("Product option not found");
    }
    if (!option.product.tracksStock) {
      throw new BadRequestException("This product doesn't track stock");
    }

    const next = "add" in change ? option.stock + change.add : change.set;

    if (!Number.isInteger(next) || next < 0) {
      throw new BadRequestException("Stock can't go below zero");
    }

    return db.productOption.update({
      where: { id: option.id },
      data: { stock: next },
    });
  }
}

export const productService = new ProductService();

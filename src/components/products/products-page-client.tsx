"use client";

import { Plus } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useState } from "react";
import type { ProductDto } from "types";

import type { ProductFormOutput } from "@/backend/validators/product-form.validator";
import {
  useAdjustStockMutation,
  useCreateProductMutation,
  useUpdateProductMutation,
} from "@/hooks/mutations/use-product-mutations";
import { useProductsQuery } from "@/hooks/queries/use-products";
import { Button, Notice } from "@/primitives";
import { errorMessage } from "@/utils/axios";
import { productPath } from "@/utils/public-links";
import { canSellOnline } from "@/utils/selling";

import { ProductCard, ProductCardSkeleton } from "./product-card";
import { ProductModal } from "./product-modal";

interface ProductsPageClientProps {
  initialProducts: ProductDto[];
  currency: string;
  publicBaseUrl: string;
  isPaymentReady: boolean;
  offersDelivery: boolean;
  offersPickup: boolean;
}

type Editing = { key: number; product?: ProductDto };

export function ProductsPageClient({
  initialProducts,
  currency,
  publicBaseUrl,
  isPaymentReady,
  offersDelivery,
  offersPickup,
}: ProductsPageClientProps) {
  const productsQuery = useProductsQuery(initialProducts);
  const products = productsQuery.data ?? initialProducts;
  const create = useCreateProductMutation();
  const update = useUpdateProductMutation();
  const adjustStock = useAdjustStockMutation();
  const sellOnline = canSellOnline({
    isPaymentReady,
    offersDelivery,
    offersPickup,
  });

  // The modal stays mounted while it animates out; `key` gives each opening
  // a fresh form and its own photo previews.
  const [editing, setEditing] = useState<Editing>({ key: 0 });
  const [modalOpen, setModalOpen] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const saving = editing.product ? update : create;

  function openEditor(product?: ProductDto) {
    create.reset();
    update.reset();
    setNotice(null);
    setEditing((prev) => ({ key: prev.key + 1, product }));
    setModalOpen(true);
  }

  function save(
    values: ProductFormOutput,
    photos: File[],
    keepPhotos: string[],
  ) {
    const input = {
      name: values.name,
      description: values.description,
      price: values.price,
      tracksStock: values.tracksStock,
      options: values.options,
    };
    const onSuccess = () => setModalOpen(false);

    if (!editing.product) {
      create.mutate({ values: input, photos }, { onSuccess });
      return;
    }

    update.mutate(
      {
        slug: editing.product.slug,
        values: input,
        photos,
        keepPhotos,
      },
      { onSuccess },
    );
  }

  function toggle(product: ProductDto, isActive: boolean) {
    setNotice(null);
    setToggling(product.id);
    update.mutate(
      { slug: product.slug, values: { isActive } },
      {
        onError: (error) => setNotice(errorMessage(error)),
        onSettled: () => setToggling(null),
      },
    );
  }

  async function saveStock(
    product: ProductDto,
    changes: { optionId: string; set: number }[],
  ) {
    setNotice(null);
    try {
      await Promise.all(
        changes.map((input) =>
          adjustStock.mutateAsync({ slug: product.slug, input }),
        ),
      );
    } catch (error) {
      setNotice(errorMessage(error));
      throw error;
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-display text-[clamp(1.9rem,1.3rem+2.2vw,3rem)] leading-[1.06] font-normal tracking-[-0.035em]">
            Products
          </h1>
          <p className="text-muted mt-2 max-w-[52ch] text-pretty">
            Each product has a link. Put it in your bio, or send it in a DM.
          </p>
        </div>
        {products.length > 0 ? (
          <Button onClick={() => openEditor()}>
            <Plus weight="bold" />
            Add a product
          </Button>
        ) : null}
      </header>

      {!sellOnline ? (
        <Notice tone="danger">
          {isPaymentReady ? (
            <>
              Set delivery or pickup before customers can buy online.{" "}
              <Link
                href="/settings#selling"
                className="font-semibold underline decoration-current underline-offset-4"
              >
                Open selling settings
              </Link>
            </>
          ) : (
            "Your bank account isn't linked, so booking links can't take payments yet."
          )}
        </Notice>
      ) : null}

      {productsQuery.isError ? (
        <Notice tone="danger">{errorMessage(productsQuery.error)}</Notice>
      ) : null}
      {notice ? <Notice tone="danger">{notice}</Notice> : null}

      {productsQuery.isPending ? (
        <ul className="grid grid-cols-1 gap-4 min-[700px]:grid-cols-2 min-[1040px]:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index}>
              <ProductCardSkeleton />
            </li>
          ))}
        </ul>
      ) : products.length === 0 ? (
        <section className="rounded-panel bg-surface px-5 py-8 sm:px-8">
          <h2 className="font-display max-w-[24ch] text-[19px] leading-[1.2] font-medium tracking-[-0.02em] text-balance">
            Add your first product.
          </h2>
          <p className="text-muted mt-2 max-w-[48ch] text-pretty">
            Its link works like a booking link: put it in your bio or send it
            in a DM.
          </p>
          <Button className="mt-6" onClick={() => openEditor()}>
            <Plus weight="bold" />
            Add a product
          </Button>
        </section>
      ) : (
        <ul className="grid grid-cols-1 gap-4 min-[700px]:grid-cols-2 min-[1040px]:grid-cols-3">
          {products.map((product) => (
            <li key={product.id} className="grid grid-cols-1">
              <ProductCard
                product={product}
                currency={currency}
                link={`${publicBaseUrl}${productPath(product.slug)}`}
                isToggling={toggling === product.id}
                onEdit={() => openEditor(product)}
                onToggle={(isActive) => toggle(product, isActive)}
                onSaveStock={(changes) => saveStock(product, changes)}
              />
            </li>
          ))}
        </ul>
      )}

      <ProductModal
        key={editing.key}
        open={modalOpen}
        onOpenChange={setModalOpen}
        product={editing.product}
        currency={currency}
        onSubmit={save}
        isPending={saving.isPending}
        error={saving.isError ? errorMessage(saving.error) : null}
      />
    </div>
  );
}

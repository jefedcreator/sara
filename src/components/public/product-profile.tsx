"use client";

import { CaretRight, Minus, Plus } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { PublicPage } from "@/components/public/public-page";
import { Button, LogoMark, Notice } from "@/primitives";
import { cn } from "@/utils/cn";
import { formatMoney } from "@/utils/format";
import { productPath } from "@/utils/public-links";
import {
  availabilityNote,
  capQuantity,
  firstAvailableOption,
  type ProductOptionPage,
  type ProductPage,
  type ProductSummary,
} from "@/utils/product-page";

import { CheckoutSheet } from "./checkout-sheet";
import { OptionChips } from "./option-chips";
import { PhotoGallery } from "./photo-gallery";

const STEP =
  "bg-surface text-ink grid size-11 cursor-pointer place-items-center rounded-full transition-[background-color,scale] duration-200 ease-out-expo hover:bg-line active:scale-96 disabled:cursor-default disabled:text-faint disabled:hover:bg-surface disabled:active:scale-100";

/** − 2 +, borrowed from the booking page's day count. */
function QuantityStepper({
  value,
  max,
  onChange,
}: {
  value: number;
  /** Null when the product doesn't track stock, so there is no cap. */
  max: number | null;
  onChange: (value: number) => void;
}) {
  return (
    <div className="border-line flex items-center justify-between rounded-full border p-1.5">
      <button
        type="button"
        className={STEP}
        aria-label="One fewer"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={18} weight="bold" aria-hidden="true" />
      </button>
      <p className="text-[17px] font-semibold tabular-nums" aria-live="polite">
        {value}
      </p>
      <button
        type="button"
        className={STEP}
        aria-label="One more"
        disabled={max !== null && value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={18} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

/** One other product, as the service page lists its siblings. */
function MoreProduct({
  product,
  currency,
}: {
  product: ProductSummary;
  currency: string;
}) {
  return (
    <Link
      href={productPath(product.slug)}
      className="rounded-card bg-surface hover:bg-accent-soft flex h-full items-center gap-4 px-4 py-3.5 transition-colors"
    >
      <span className="rounded-chip bg-canvas relative flex size-14 shrink-0 items-center justify-center overflow-hidden">
        {product.photo ? (
          <Image src={product.photo} alt="" fill sizes="56px" className="object-cover" />
        ) : (
          <LogoMark accent={false} className="text-line size-7" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{product.name}</span>
        <span className="text-muted block text-sm">
          {formatMoney(product.price, currency)}
        </span>
      </span>
      <CaretRight weight="bold" className="text-faint size-4 shrink-0" aria-hidden />
    </Link>
  );
}

/**
 * A product's public page: its photos, name and price, options and quantity,
 * then the description and how it gets to the customer. One action opens the
 * checkout sheet; on phones it rides the bottom bar and on desktop it sits
 * below the price, while the square photo column stays in view.
 */
export function ProductProfile({
  page,
  others,
}: {
  page: ProductPage;
  others: ProductSummary[];
}) {
  const first = firstAvailableOption(page.options);
  const [selectedId, setSelectedId] = useState(first?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [caps, setCaps] = useState<Record<string, number>>({});
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const money = (amount: number | string) =>
    formatMoney(amount, page.currency);

  const availableFor = (option: ProductOptionPage) => {
    if (option.available === null) return null;
    const cap = caps[option.id];
    return cap === undefined
      ? option.available
      : Math.min(option.available, cap);
  };

  const options = page.options.map((option) => ({
    ...option,
    available: availableFor(option),
  }));

  const selected =
    options.find((option) => option.id === selectedId) ??
    options[0] ??
    first;
  const selectedAvailable = selected ? availableFor(selected) : 0;
  const soldOut =
    options.length === 0 ||
    options.every((option) => option.available === 0);
  const unitPrice = Number(selected?.price ?? page.price);
  const total = unitPrice * quantity;
  const note = availabilityNote(selectedAvailable);

  function pickOption(id: string) {
    setSelectedId(id);
    setQuantity(1);
  }

  function changeQuantity(value: number) {
    setQuantity(capQuantity(value, selectedAvailable));
  }

  function lowerCap(optionId: string, max: number) {
    setCaps((current) => ({ ...current, [optionId]: max }));
    if (optionId === selectedId) {
      setQuantity((current) => capQuantity(current, max));
    }
  }

  function openCheckout() {
    if (!selected || soldOut) return;
    setCheckoutOpen(true);
  }

  const action = unavailable ? (
    <Notice tone="danger">{unavailable}</Notice>
  ) : soldOut ? (
    <Button size="lg" disabled className="w-full">
      Sold out
    </Button>
  ) : !page.canBuy ? (
    <Notice className="text-center">
      Not available to buy online yet. Message {page.businessName} to order.
    </Notice>
  ) : (
    <Button size="lg" onClick={openCheckout} className="w-full">
      Buy now · {money(total)}
    </Button>
  );

  return (
    <PublicPage
      businessName={page.businessName}
      credit="Orders"
      width="wide"
      className="pb-32 lg:pb-16"
    >
      <div className="grid gap-8 pt-4 lg:grid-cols-[1fr_460px] lg:items-start lg:gap-16 lg:pt-12">
        <PhotoGallery
          photos={page.photos}
          name={page.name}
          className="animate-rise lg:sticky lg:top-8 lg:order-2"
        />

        <section aria-labelledby="product-h" className="animate-rise-1 lg:order-1">
          <h1
            id="product-h"
            className="font-display max-w-[18ch] text-[clamp(2.1rem,1.4rem+3vw,3.4rem)] leading-[1.04] font-[380] tracking-[-0.035em] text-balance"
          >
            {page.name}
          </h1>
          <p className="mt-3 text-[17px] font-semibold tabular-nums">
            {money(unitPrice)}
          </p>
          {page.area ? (
            <p className="text-muted mt-1 text-[15px]">{page.area}</p>
          ) : null}

          {/* Desktop: the one action, under the price. */}
          <div className="mt-6 hidden max-w-[360px] lg:block">{action}</div>

          <div className="mt-6">
            <OptionChips options={options} selectedId={selected?.id ?? ""} onSelect={pickOption} />
          </div>

          {note ? (
            <p className="text-ink-2 mt-3 text-[15px] font-semibold" aria-live="polite">
              {note}
            </p>
          ) : null}

          {!soldOut && selected ? (
            <div className="mt-5 max-w-[360px]">
              <QuantityStepper
                value={quantity}
                max={selectedAvailable}
                onChange={changeQuantity}
              />
            </div>
          ) : null}

          {page.description ? (
            <p className="text-muted mt-8 max-w-[60ch] text-pretty whitespace-pre-line">
              {page.description}
            </p>
          ) : null}

          {page.offersDelivery || page.offersPickup ? (
            <dl className="border-line mt-8 grid max-w-[480px] gap-3 border-t pt-6 text-[15px]">
              {page.offersDelivery ? (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted">Delivery</dt>
                  <dd className="text-right tabular-nums">
                    {money(Number(page.deliveryFee ?? 0))}
                  </dd>
                </div>
              ) : null}
              {page.offersPickup ? (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted">Pickup</dt>
                  <dd className="text-right text-pretty">
                    {page.pickupAddress ?? page.businessName}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </section>
      </div>

      {others.length > 0 ? (
        <section aria-labelledby="more-h" className="animate-rise-2 mt-16 lg:mt-24">
          <h2
            id="more-h"
            className="font-display text-[22px] leading-[1.2] font-medium tracking-[-0.02em]"
          >
            More from {page.businessName}
          </h2>
          <ul className="mt-5 grid grid-cols-1 gap-2.5 min-[700px]:grid-cols-2">
            {others.map((other) => (
              <li key={other.slug} className="min-w-0">
                <MoreProduct product={other} currency={page.currency} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Phone: the one action, pinned to the bottom edge. */}
      <div className="border-line bg-canvas/92 fixed inset-x-0 bottom-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
        {action}
      </div>

      {selected ? (
        <CheckoutSheet
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          page={page}
          option={selected}
          quantity={quantity}
          onCap={lowerCap}
          onUnavailable={setUnavailable}
        />
      ) : null}
    </PublicPage>
  );
}

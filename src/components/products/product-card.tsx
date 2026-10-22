import { PencilSimple } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import { useState } from "react";
import type { ProductDto } from "types";

import { CopyLinkButton } from "@/app/components/landing/CopyLinkButton";
import { Button, Input, LogoMark, Skeleton, StatusPill, Switch } from "@/primitives";
import { cn } from "@/utils/cn";
import { formatMoney } from "@/utils/format";
import { stockBadge, type StockTone } from "@/utils/stock";

interface ProductCardProps {
  product: ProductDto;
  currency: string;
  link: string;
  isToggling: boolean;
  onEdit: () => void;
  onToggle: (isActive: boolean) => void;
  onSaveStock: (changes: { optionId: string; set: number }[]) => Promise<void>;
}

const STOCK_TONE: Record<StockTone, string> = {
  ok: "text-muted",
  low: "text-accent-ink font-semibold",
  out: "text-ink-2 font-semibold",
  untracked: "text-faint",
};

/**
 * The top of a product card: the first photo in a square frame, so the owner
 * sees the same crop customers see. No photo shows the brand mark.
 */
function ProductImagePreview({
  image,
  name,
  link,
  isActive,
}: {
  image: string | null;
  name: string;
  link: string;
  isActive: boolean;
}) {
  const isCloudinary = Boolean(image?.startsWith("https://res.cloudinary.com"));

  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={-1}
      aria-hidden="true"
      title={`Open ${name} product link`}
      className="border-line bg-canvas/40 group/photo relative block aspect-square cursor-pointer overflow-hidden border-b"
    >
      {image ? (
        <Image
          src={image}
          alt={name}
          fill
          sizes="(min-width: 1040px) 33vw, (min-width: 700px) 50vw, 100vw"
          className={cn(
            "ease-out-expo object-cover transition-transform duration-200 group-hover/card:scale-[1.04]",
            !isActive && "opacity-75 grayscale-[25%]",
          )}
          unoptimized={!isCloudinary}
        />
      ) : (
        <div
          className={cn(
            "bg-surface group-hover/card:bg-canvas flex size-full items-center justify-center transition-colors duration-200",
            !isActive && "opacity-75",
          )}
        >
          <LogoMark
            accent={false}
            className="text-line ease-out-expo size-12 transition-transform duration-200 group-hover/card:scale-110"
          />
        </div>
      )}
    </a>
  );
}

/**
 * One product in the owner's list: a square photo, its options and stock, the
 * copy-link field, and the Live switch. Stock is edited in place: the rows
 * become number fields, then Save changes each option that moved.
 */
export function ProductCard({
  product,
  currency,
  link,
  isToggling,
  onEdit,
  onToggle,
  onSaveStock,
}: ProductCardProps) {
  const switchId = `live-${product.id}`;
  const displayUrl = link.replace(/^https?:\/\//, "");
  const [editingStock, setEditingStock] = useState(false);
  const [stockValues, setStockValues] = useState<Record<string, string>>({});
  const [savingStock, setSavingStock] = useState(false);

  const rows = product.options.map((option) => {
    const raw = stockValues[option.id] ?? "";
    const valid = /^\d+$/.test(raw.trim());
    return {
      option,
      raw,
      valid,
      value: valid ? Number(raw.trim()) : null,
    };
  });
  const invalidStock = rows.some((row) => !row.valid);
  const changes = rows.flatMap((row) =>
    row.valid && row.value !== null && row.value !== row.option.stock
      ? [{ optionId: row.option.id, set: row.value }]
      : [],
  );

  function startStock() {
    setStockValues(
      Object.fromEntries(
        product.options.map((option) => [option.id, String(option.stock)]),
      ),
    );
    setEditingStock(true);
  }

  async function saveStock() {
    if (invalidStock || changes.length === 0) return;

    setSavingStock(true);
    try {
      await onSaveStock(changes);
      setEditingStock(false);
    } catch {
      // The page shows the API's message; keep the fields open to fix them.
    } finally {
      setSavingStock(false);
    }
  }

  return (
    <article className="group/card rounded-card bg-surface hover:shadow-card flex h-full flex-col overflow-hidden transition-shadow duration-200">
      <ProductImagePreview
        image={product.photos[0] ?? null}
        name={product.name}
        link={link}
        isActive={product.isActive}
      />

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-[19px] leading-[1.2] font-medium tracking-[-0.02em] break-words">
              {product.name}
            </h3>
            <p className="text-muted mt-1 text-sm">
              {formatMoney(product.price, currency)}
              {product.options.length > 1
                ? ` · ${product.options.length} options`
                : ""}
            </p>
            {product.description ? (
              <p className="text-muted mt-1.5 truncate text-sm">
                {product.description}
              </p>
            ) : null}
          </div>
          <StatusPill
            tone={product.isActive ? "accent" : "muted"}
            className={!product.isActive ? "bg-canvas" : undefined}
          >
            {product.isActive ? "Live" : "Paused"}
          </StatusPill>
        </header>

        {rows.length > 0 ? (
          <>
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-ink-2 text-sm font-semibold">
                {editingStock ? "How many you have now" : "Options"}
              </p>
              {product.tracksStock && !editingStock ? (
                <Button variant="ghost" size="sm" onClick={startStock}>
                  Update stock
                </Button>
              ) : null}
            </div>

            <ul className="divide-line mt-1 grid divide-y">
              {rows.map(({ option, raw, valid }) => {
                const badge = stockBadge(product.tracksStock, option.stock);
                const optionName = option.name || "One option";

                return (
                  <li
                    key={option.id}
                    className={cn(
                      "items-center justify-between gap-3 py-2.5",
                      editingStock
                        ? "grid grid-cols-[minmax(0,1fr)_96px]"
                        : "flex",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-ink truncate text-[14px] font-semibold">
                        {optionName}
                      </p>
                      {option.price != null ? (
                        <p className="text-muted mt-0.5 text-sm">
                          {formatMoney(option.price, currency)}
                        </p>
                      ) : null}
                    </div>

                    {editingStock ? (
                      <Input
                        inputMode="numeric"
                        value={raw}
                        aria-label={
                          option.name
                            ? `How many ${option.name} you have`
                            : "How many you have"
                        }
                        aria-invalid={valid ? undefined : true}
                        className="h-9 text-right"
                        onChange={(event) =>
                          setStockValues((current) => ({
                            ...current,
                            [option.id]: event.target.value,
                          }))
                        }
                      />
                    ) : (
                      <span
                        className={cn(
                          "shrink-0 text-sm whitespace-nowrap",
                          STOCK_TONE[badge.tone],
                        )}
                      >
                        {badge.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}

        {editingStock ? (
          <div className="mt-2">
            {invalidStock ? (
              <p className="text-danger text-sm" role="alert">
                Enter how many you have.
              </p>
            ) : null}
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                variant="dark"
                isLoading={savingStock}
                disabled={invalidStock || changes.length === 0}
                onClick={() => void saveStock()}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={savingStock}
                onClick={() => setEditingStock(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "bg-canvas border-line mt-4 flex items-center gap-2 rounded-full border py-1 pr-1 pl-3.5",
            !product.isActive && "opacity-60",
          )}
        >
          <code
            className="text-ink min-w-0 flex-1 truncate font-mono text-sm"
            title={link}
          >
            {displayUrl}
          </code>
          <CopyLinkButton url={link} />
        </div>
        {!product.isActive ? (
          <p className="text-muted mt-2 text-sm">
            Paused: this link shows customers that it isn&apos;t open.
          </p>
        ) : null}

        <footer className="border-line mt-auto flex items-center gap-2 border-t pt-4">
          <label
            htmlFor={switchId}
            className="text-ink-2 flex cursor-pointer items-center gap-2.5 text-sm font-semibold select-none"
          >
            <Switch
              id={switchId}
              checked={product.isActive}
              disabled={isToggling}
              onCheckedChange={onToggle}
            />
            Live
          </label>
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={onEdit}
          >
            <PencilSimple weight="bold" />
            Edit
          </Button>
        </footer>
      </div>
    </article>
  );
}

/** A card's shape while the products list loads: the square, then its lines. */
export function ProductCardSkeleton() {
  return (
    <div className="rounded-card bg-surface overflow-hidden" aria-hidden="true">
      <div className="border-line aspect-square border-b">
        <Skeleton className="bg-canvas size-full rounded-none" />
      </div>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Skeleton className="bg-canvas h-5 w-3/5" />
            <Skeleton className="bg-canvas mt-2 h-4 w-2/5" />
          </div>
          <Skeleton className="bg-canvas h-6 w-14 rounded-full" />
        </div>
        <div className="grid gap-2">
          <Skeleton className="bg-canvas h-5 w-full" />
          <Skeleton className="bg-canvas h-5 w-4/5" />
        </div>
        <Skeleton className="bg-canvas h-9 w-full rounded-full" />
        <div className="border-line mt-2 flex items-center justify-between border-t pt-4">
          <Skeleton className="bg-canvas h-6 w-20 rounded-full" />
          <Skeleton className="bg-canvas h-10 w-20 rounded-full" />
        </div>
      </div>
    </div>
  );
}

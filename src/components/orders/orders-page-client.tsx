"use client";

import { useQueryStates } from "nuqs";
import { useState } from "react";
import type { OrderDto, Page } from "types";

import { useUpdateOrderMutation } from "@/hooks/mutations/use-order-mutations";
import { useOrdersQuery } from "@/hooks/queries/use-orders";
import { ConfirmModal, Notice, Pager, Segmented, Skeleton } from "@/primitives";
import type { OrderListParams } from "@/utils/api";
import { errorMessage } from "@/utils/axios";
import { publicPath } from "@/utils/public-links";
import { orderListParams, ordersParams, type OrderView } from "@/utils/url-state";

import { OrderRow } from "./order-row";

const VIEWS: { value: OrderView; label: string }[] = [
  { value: "send", label: "To send out" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

const EMPTY: Record<OrderView, string> = {
  send: "Paid orders land here. Share a product link to get your first.",
  done: "Delivered and collected orders show here.",
  cancelled: "No cancelled orders.",
};

interface OrdersPageClientProps {
  publicBaseUrl: string;
  initial: { params: OrderListParams; data: Page<OrderDto> };
}

export function OrdersPageClient({ publicBaseUrl, initial }: OrdersPageClientProps) {
  const [{ view, page }, setUrl] = useQueryStates(ordersParams, { history: "push" });
  const params = orderListParams(view, page);
  const query = useOrdersQuery(params, initial);
  const update = useUpdateOrderMutation();

  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The row whose address save failed, so its error shows under its own field.
  const [addressError, setAddressError] = useState<{ slug: string; message: string } | null>(null);
  // Kept after closing so the modal keeps its content while animating out.
  const [target, setTarget] = useState<OrderDto | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  function advance(order: OrderDto, status: "READY" | "COMPLETED" | "CANCELLED", onDone?: () => void) {
    setNotice(null);
    setBusySlug(order.slug);
    update.mutate(
      { slug: order.slug, values: { status } },
      {
        onSuccess: onDone,
        // A failed cancel shows in the open confirm sheet, so it isn't repeated on the page.
        onError: (error) => {
          if (status !== "CANCELLED") setNotice(errorMessage(error));
        },
        onSettled: () => setBusySlug(null),
      },
    );
  }

  function switchToDelivery(order: OrderDto, address: string, onDone: () => void) {
    setNotice(null);
    setAddressError(null);
    setBusySlug(order.slug);
    update.mutate(
      { slug: order.slug, values: { fulfilment: "DELIVERY", deliveryAddress: address } },
      {
        onSuccess: onDone,
        onError: (error) => setAddressError({ slug: order.slug, message: errorMessage(error) }),
        onSettled: () => setBusySlug(null),
      },
    );
  }

  const rows = query.data?.data ?? [];

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="font-display text-[clamp(1.9rem,1.3rem+2.2vw,3rem)] leading-[1.06] font-normal tracking-[-0.035em]">
          Orders
        </h1>
        <p className="text-muted mt-2 max-w-[52ch] text-pretty">
          Paid orders from your product links. Move each one along as you pack and hand it over;
          customers get an email at every step.
        </p>
      </header>

      <Segmented
        label="Show"
        value={view}
        options={VIEWS}
        onChange={(next) => void setUrl({ view: next, page: 1 })}
      />

      {notice ? <Notice tone="danger">{notice}</Notice> : null}

      {query.isPending ? (
        <div className="grid gap-2.5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="rounded-card h-[132px]" />
          ))}
        </div>
      ) : query.isError ? (
        <Notice tone="danger">{errorMessage(query.error)}</Notice>
      ) : rows.length === 0 ? (
        <p className="rounded-card bg-surface text-muted px-5 py-6 text-[15px]">{EMPTY[view]}</p>
      ) : (
        <ul className={query.isPlaceholderData ? "grid gap-2.5 opacity-60" : "grid gap-2.5"}>
          {rows.map((order) => (
            <li key={order.id}>
              <OrderRow
                order={order}
                link={`${publicBaseUrl}${publicPath("order", order.publicId)}`}
                busy={busySlug === order.slug}
                error={addressError?.slug === order.slug ? addressError.message : null}
                onAdvance={(status) => advance(order, status)}
                onCancel={() => {
                  update.reset();
                  setTarget(order);
                  setCancelOpen(true);
                }}
                onSwitchToDelivery={(address, done) => switchToDelivery(order, address, done)}
              />
            </li>
          ))}
        </ul>
      )}

      <Pager
        page={page}
        totalPages={query.data?.totalPages ?? 1}
        onChange={(next) => void setUrl({ page: next })}
      />

      <ConfirmModal
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={target ? `Cancel ${target.orderNumber ?? target.slug} and put the stock back?` : "Cancel order?"}
        description={
          update.isError
            ? errorMessage(update.error)
            : "The customer gets a cancellation email. Refunds, if any, are up to you."
        }
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        tone="danger"
        isPending={update.isPending}
        onConfirm={() => target && advance(target, "CANCELLED", () => setCancelOpen(false))}
      />
    </div>
  );
}

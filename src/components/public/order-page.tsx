import type { ReactNode } from "react";

import { AwaitConfirmation } from "@/components/book/await-confirmation";
import { PublicPage } from "@/components/public/public-page";
import { Button, StatusPill } from "@/primitives";
import { cn } from "@/utils/cn";
import { formatMoney } from "@/utils/format";
import { formatDate } from "@/utils/labels";
import { orderHeadline, type PublicOrder } from "@/utils/order-page";

function MoneyRow({
  label,
  strong,
  children,
}: {
  label: string;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4",
        strong && "font-semibold",
      )}
    >
      <dt className={strong ? undefined : "text-muted"}>{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * The page behind a customer's order link: the order's state, what was
 * bought, and where it is going, laid out like an invoice or receipt. While
 * Paystack confirms the payment, the order itself waits for the webhook.
 */
export function OrderPage({ order }: { order: PublicOrder }) {
  const money = (amount: number) => formatMoney(amount, order.currency);
  const awaiting = order.status === "AWAITING_PAYMENT";
  const paid = order.paidAt ? `Paid ${formatDate(order.paidAt)}` : null;
  const place =
    order.fulfilment === "PICKUP"
      ? (order.pickupAddress ?? order.businessName)
      : (order.deliveryAddress ?? "To be confirmed");

  return (
    <PublicPage businessName={order.businessName} credit="Orders">
      <section aria-labelledby="order-h" className="animate-rise pt-4 lg:pt-12">
        <StatusPill tone={order.statusTone}>{order.statusLabel}</StatusPill>
        <h1
          id="order-h"
          className="font-display mt-4 text-[clamp(2.1rem,1.4rem+3vw,3.4rem)] leading-[1.04] font-[380] tracking-[-0.035em] text-balance"
        >
          {orderHeadline(order)}
        </h1>
        <p className="text-muted mt-3 text-pretty">
          From {order.businessName}
          {paid ? (
            <>
              {" · "}
              <span className="whitespace-nowrap">{paid}</span>
            </>
          ) : null}
        </p>
      </section>

      {awaiting ? (
        <div className="animate-rise-2 mt-8">
          <AwaitConfirmation />
        </div>
      ) : (
        <>
          {/* The order itself: the same white sheet invoices and receipts wear. */}
          <section
            aria-label="Order details"
            className="rounded-card border-line bg-canvas shadow-card animate-rise-2 mt-8 border px-5 py-6 sm:px-8 sm:py-8"
          >
            <ul className="space-y-3 text-[15px]">
              {order.lines.map((line, index) => (
                <li
                  key={`${line.name}-${index}`}
                  className="flex items-baseline justify-between gap-4"
                >
                  <span className="min-w-0">
                    <span className="block whitespace-pre-line">{line.name}</span>
                    {line.quantity > 1 ? (
                      <span className="text-muted mt-0.5 block text-sm tabular-nums">
                        {line.quantity} × {money(line.unitPrice)}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-ink-2 shrink-0 tabular-nums">
                    {money(line.total)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="border-line mt-5 space-y-2 border-t pt-5 text-[15px]">
              <MoneyRow label="Items">{money(order.subtotal)}</MoneyRow>
              {order.fulfilment === "DELIVERY" ? (
                <MoneyRow label="Delivery fee">
                  {money(order.deliveryFee)}
                </MoneyRow>
              ) : null}
              <MoneyRow label="Total" strong>
                {money(order.total)}
              </MoneyRow>
            </dl>

            <div className="border-line mt-5 border-t pt-5 text-[15px]">
              <p className="text-muted text-sm font-semibold">
                {order.fulfilment === "PICKUP" ? "Pickup from" : "Delivery to"}
              </p>
              <p className="mt-1 text-pretty">{place}</p>
            </div>
          </section>

          {order.receiptPath ? (
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="animate-rise-2 mt-8 w-full shadow-none sm:w-auto"
            >
              <a href={order.receiptPath}>View receipt</a>
            </Button>
          ) : null}
        </>
      )}
    </PublicPage>
  );
}

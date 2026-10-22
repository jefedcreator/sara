"use client";

import Link from "next/link";
import { useState } from "react";
import type { DashboardData, ProductDto, Sells, ServiceDto } from "types";

import { DocumentModal } from "@/components/documents/document-modal";
import { useDashboardQuery } from "@/hooks/queries/use-dashboard";
import { useDocumentComposer } from "@/hooks/use-document-composer";
import { StatusPill } from "@/primitives";
import { formatLongDate, formatMoney, formatSlotTime, todayEventLabel, todayIso } from "@/utils/format";
import { BOOKING_STATUS } from "@/utils/labels";
import { menuNumber, type MenuAction } from "@/utils/menu";
import { stockBadge } from "@/utils/stock";

import { MenuNumeral } from "./menu-numeral";
import { Panel } from "./panel";
import { RevenueBars } from "./revenue-bars";
import { ShareLinkSheet } from "./share-link-sheet";

interface DashboardPageClientProps {
  initialData: DashboardData;
  sells: Sells;
  services: ServiceDto[];
  products: ProductDto[];
  publicBaseUrl: string;
}

const REVENUE_EMPTY: Record<Sells, string> = {
  SERVICES: "Confirmed bookings will show here, service by service.",
  PRODUCTS: "Paid orders will show here, product by product.",
  BOTH: "Confirmed bookings and paid orders will show here.",
};

const REVENUE_NOTE: Record<Sells, string> = {
  SERVICES: "Confirmed bookings, all time, at each service's current price.",
  PRODUCTS: "Paid orders, all time.",
  BOTH: "Confirmed bookings at each service's current price, plus paid orders. All time.",
};

/**
 * The web version of the chat menu. The numbers come from the same `MENU` the
 * chat uses, so each action and section matches the number the chat gives it
 * for this business.
 */
export function DashboardPageClient({
  initialData,
  sells,
  services,
  products,
  publicBaseUrl,
}: DashboardPageClientProps) {
  const { data = initialData } = useDashboardQuery(initialData);
  const { currency, summary } = data;
  const invoice = useDocumentComposer("invoice", currency);
  const receipt = useDocumentComposer("receipt", currency);
  const [shareOpen, setShareOpen] = useState(false);
  const active = services.filter((s) => s.isActive);
  const num = (action: MenuAction) => menuNumber(sells, action) ?? undefined;

  const bookingsPanel = (
    <Panel n={num("TODAY_BOOKINGS")} title="Today's bookings" href="/bookings">
      {data.todayBookings.length === 0 ? (
        <p className="text-muted text-[15px]">No bookings today.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {data.todayBookings.map((booking) => {
            const status = BOOKING_STATUS[booking.status];
            return (
              <li key={`${booking.slug}-${booking.kind}`} className="bg-canvas rounded-card flex items-center gap-3 px-4 py-3">
                <span className="text-accent-ink min-w-[3.2em] font-semibold">
                  {formatSlotTime(booking.at)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{booking.serviceName}</p>
                  <p className="text-muted truncate text-sm">
                    {booking.kind === "SLOT" ? booking.clientName : `${todayEventLabel(booking.kind)} · ${booking.clientName}`}
                  </p>
                </div>
                {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );

  const ordersPanel = (
    <Panel n={num("ORDERS_TO_SEND")} title="Orders to send out" href="/orders">
      {data.ordersToSendOut.length === 0 ? (
        <p className="text-muted text-[15px]">Nothing to send out. Paid orders will show here.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {data.ordersToSendOut.map((order) => (
            <li key={order.slug} className="bg-canvas rounded-card flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{order.clientName}</p>
                <p className="text-muted truncate text-sm">
                  {order.orderNumber} · {order.fulfilment === "DELIVERY" ? "Delivery" : "Pickup"}
                </p>
              </div>
              <span className="font-semibold whitespace-nowrap">{formatMoney(order.total, currency)}</span>
              <StatusPill tone={order.status === "NEW" ? "accent" : "muted"}>
                {order.status === "NEW" ? "New" : "Ready"}
              </StatusPill>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );

  const unpaidPanel = (
    <Panel n={num("UNPAID")} title="Unpaid invoices" href="/invoices?view=unpaid">
      {data.unpaidInvoices.length === 0 ? (
        <p className="text-muted text-[15px]">No unpaid invoices. You&apos;re all settled up.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {data.unpaidInvoices.map((inv) => (
            <li key={inv.slug} className="bg-canvas rounded-card flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{inv.clientName}</p>
                <p className="text-muted text-sm">{inv.invoiceNumber}</p>
              </div>
              <span className="font-semibold whitespace-nowrap">
                {formatMoney(inv.outstanding, inv.currency)}
              </span>
              {inv.url ? (
                <a
                  href={inv.url}
                  target="_blank"
                  rel="noopener"
                  className="text-ink-2 hover:text-ink decoration-accent-tint text-sm font-semibold underline underline-offset-4"
                >
                  PDF
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );

  // Not a chat action, so it has no number. Only there when something is low.
  const lowPanel =
    data.runningLow.length === 0 ? null : (
      <Panel title="Running low" href="/products">
        <ul className="grid grid-cols-1 gap-2">
          {data.runningLow.map((item) => {
            const badge = stockBadge(true, item.stock);
            return (
              <li key={`${item.productSlug}-${item.label}`} className="bg-canvas rounded-card flex items-center gap-3 px-4 py-3">
                <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{item.label}</p>
                <StatusPill tone={badge.tone === "out" ? "danger" : "muted"}>{badge.label}</StatusPill>
              </li>
            );
          })}
        </ul>
      </Panel>
    );

  return (
    <div className="grid grid-cols-1 gap-8">
      <header>
        <h1 className="font-display text-[clamp(1.9rem,1.3rem+2.2vw,3rem)] leading-[1.06] font-normal tracking-[-0.035em]">
          Today
        </h1>
        <p className="text-muted mt-2">{formatLongDate(todayIso())}</p>
      </header>

      {/* The chat's first three actions, numbered as the chat numbers them. */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <ActionButton n={num("NEW_INVOICE")} label="New invoice" onClick={invoice.start} />
        <ActionButton n={num("NEW_RECEIPT")} label="New receipt" onClick={receipt.start} />
        {sells === "SERVICES" ? (
          <ActionButton n={num("SHARE_LINK")} label="Share a service" href="/services" />
        ) : sells === "PRODUCTS" ? (
          <ActionButton n={num("SHARE_LINK")} label="Share a link" href="/products" />
        ) : (
          <ActionButton n={num("SHARE_LINK")} label="Share a link" onClick={() => setShareOpen(true)} />
        )}
      </div>

      {/* 6: business summary */}
      <section aria-labelledby="summary-h" className="grid gap-3">
        <h2 id="summary-h" className="sr-only">
          Business summary
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Today's revenue" value={formatMoney(summary.todayRevenue, currency)} />
          <Stat label="This week" value={formatMoney(summary.weekRevenue, currency)} />
          <Stat
            label="Unpaid"
            value={formatMoney(summary.unpaidTotal, currency)}
            note={`${summary.unpaidCount} invoice${summary.unpaidCount === 1 ? "" : "s"}`}
          />
        </div>
      </section>

      {/* An odd panel out spans the row, so the grid never leaves a hole. */}
      <div className="grid grid-cols-1 gap-4 min-[1040px]:grid-cols-2 min-[1040px]:items-start min-[1040px]:[&>:last-child:nth-child(odd)]:col-span-2">
        {sells === "PRODUCTS" ? ordersPanel : bookingsPanel}
        {unpaidPanel}
        {sells === "BOTH" ? ordersPanel : null}
        {lowPanel}
      </div>

      <Panel n={num("SUMMARY")} title="Revenue by item">
        {data.revenueByItem.length === 0 ? (
          <p className="text-muted text-[15px]">{REVENUE_EMPTY[sells]}</p>
        ) : (
          <>
            <RevenueBars rows={data.revenueByItem} currency={currency} />
            <p className="text-muted mt-4 text-[13px]">{REVENUE_NOTE[sells]}</p>
          </>
        )}
      </Panel>

      <DocumentModal {...invoice.modal} services={active} />
      <DocumentModal {...receipt.modal} services={active} />
      {sells === "BOTH" ? (
        <ShareLinkSheet
          open={shareOpen}
          onOpenChange={setShareOpen}
          services={services}
          products={products}
          publicBaseUrl={publicBaseUrl}
        />
      ) : null}
    </div>
  );
}

function ActionButton({
  n,
  label,
  onClick,
  href,
}: {
  n?: number;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const classes =
    "bg-surface hover:bg-accent-soft ease-out-expo flex cursor-pointer items-center gap-3 rounded-card px-4 py-3.5 text-left text-[15px] font-semibold no-underline transition-[background-color,scale] duration-200 active:scale-98";
  const body = (
    <>
      {n === undefined ? null : <MenuNumeral n={n} />}
      {label}
    </>
  );
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={classes}>
      {body}
    </button>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-card border-line border px-5 py-4">
      <p className="text-muted text-sm font-semibold">{label}</p>
      <p className="font-display mt-1.5 text-[clamp(1.6rem,1.3rem+1.2vw,2.2rem)] leading-none font-[330] tracking-[-0.035em]">
        {value}
      </p>
      {note ? <p className="text-muted mt-1.5 text-sm">{note}</p> : null}
    </div>
  );
}

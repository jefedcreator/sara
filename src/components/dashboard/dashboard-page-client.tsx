"use client";

import Link from "next/link";
import type { DashboardData, ServiceDto } from "types";

import { DocumentModal } from "@/components/documents/document-modal";
import { useDashboardQuery } from "@/hooks/queries/use-dashboard";
import { useDocumentComposer } from "@/hooks/use-document-composer";
import { StatusPill } from "@/primitives";
import { formatLongDate, formatMoney, formatSlotTime, todayEventLabel, todayIso } from "@/utils/format";
import { BOOKING_STATUS } from "@/utils/labels";

import { MenuNumeral } from "./menu-numeral";
import { Panel } from "./panel";
import { RevenueBars } from "./revenue-bars";

interface DashboardPageClientProps {
  initialData: DashboardData;
  services: ServiceDto[];
}

/**
 * The web version of the chat menu: 1-3 are actions, 4-6 are the answers the
 * chat gives, with room for more detail than a chat reply.
 */
export function DashboardPageClient({ initialData, services }: DashboardPageClientProps) {
  const { data = initialData } = useDashboardQuery(initialData);
  const { currency, summary } = data;
  const invoice = useDocumentComposer("invoice", currency);
  const receipt = useDocumentComposer("receipt", currency);
  const active = services.filter((s) => s.isActive);

  return (
    <div className="grid gap-8">
      <header>
        <h1 className="font-display text-[clamp(1.9rem,1.3rem+2.2vw,3rem)] leading-[1.06] font-normal tracking-[-0.035em]">
          Today
        </h1>
        <p className="text-muted mt-2">{formatLongDate(todayIso())}</p>
      </header>

      {/* 1-3: the chat's actions */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <ActionButton n={1} label="New invoice" onClick={invoice.start} />
        <ActionButton n={2} label="New receipt" onClick={receipt.start} />
        <ActionButton n={3} label="Share a service" href="/services" />
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

      <div className="grid gap-4 min-[1040px]:grid-cols-2 min-[1040px]:items-start">
        <Panel n={5} title="Today's bookings" href="/bookings">
          {data.todayBookings.length === 0 ? (
            <p className="text-muted text-[15px]">No bookings today.</p>
          ) : (
            <ul className="grid gap-2">
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

        <Panel n={4} title="Unpaid invoices" href="/invoices?view=unpaid">
          {data.unpaidInvoices.length === 0 ? (
            <p className="text-muted text-[15px]">No unpaid invoices. You&apos;re all settled up.</p>
          ) : (
            <ul className="grid gap-2">
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
      </div>

      <Panel n={6} title="Revenue by service">
        {data.revenueByService.length === 0 ? (
          <p className="text-muted text-[15px]">
            Confirmed bookings will show here, service by service.
          </p>
        ) : (
          <>
            <RevenueBars rows={data.revenueByService} currency={currency} />
            <p className="text-muted mt-4 text-[13px]">
              Confirmed bookings, all time, at each service&apos;s current price.
            </p>
          </>
        )}
      </Panel>

      <DocumentModal {...invoice.modal} services={active} />
      <DocumentModal {...receipt.modal} services={active} />
    </div>
  );
}

function ActionButton({
  n,
  label,
  onClick,
  href,
}: {
  n: number;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const classes =
    "bg-surface hover:bg-accent-soft ease-out-expo flex cursor-pointer items-center gap-3 rounded-card px-4 py-3.5 text-left text-[15px] font-semibold no-underline transition-[background-color,scale] duration-200 active:scale-98";
  const body = (
    <>
      <MenuNumeral n={n} />
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

"use client";

import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useState } from "react";
import type { CustomerDetail, TimelineEntry } from "types";

import { Panel } from "@/components/dashboard/panel";
import { useCustomerQuery } from "@/hooks/queries/use-customers";
import { Button, Notice, StatusPill } from "@/primitives";
import { errorMessage } from "@/utils/axios";
import { formatMoney } from "@/utils/format";
import { BOOKING_STATUS, formatDate, INVOICE_STATUS } from "@/utils/labels";

import { CustomerEditModal } from "./customer-edit-modal";

interface CustomerDetailClientProps {
  initial: CustomerDetail;
  currency: string;
}

export function CustomerDetailClient({ initial, currency }: CustomerDetailClientProps) {
  const customerQuery = useCustomerQuery(initial.id, initial);
  const customer = customerQuery.data ?? initial;
  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState(0);

  function openEditor() {
    setEditKey((key) => key + 1);
    setEditOpen(true);
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <header>
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/customers"
            className="text-muted hover:text-ink inline-flex items-center gap-1.5 text-sm font-semibold no-underline transition-colors duration-200"
          >
            <ArrowLeft weight="bold" className="size-4" aria-hidden="true" />
            Customers
          </Link>
          <Button variant="ghost" size="sm" onClick={openEditor}>
            Edit details
          </Button>
        </div>

        <h1 className="font-display mt-5 text-[clamp(1.9rem,1.3rem+2.2vw,3rem)] leading-[1.06] font-normal tracking-[-0.035em] text-balance">
          {customer.name}
        </h1>
        {customer.phone || customer.email ? (
          <p className="text-muted mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
            {customer.phone ? (
              <a
                href={`tel:${customer.phone}`}
                className="hover:text-ink underline decoration-accent-tint underline-offset-4"
              >
                {customer.phone}
              </a>
            ) : null}
            {customer.email ? (
              <a
                href={`mailto:${customer.email}`}
                className="hover:text-ink break-all underline decoration-accent-tint underline-offset-4"
              >
                {customer.email}
              </a>
            ) : null}
          </p>
        ) : null}
      </header>

      {customerQuery.isError ? (
        <Notice tone="danger">{errorMessage(customerQuery.error)}</Notice>
      ) : null}

      <section aria-labelledby="customer-figures" className="grid gap-3 sm:grid-cols-3">
        <h2 id="customer-figures" className="sr-only">
          Customer totals
        </h2>
        <Stat label="Spent" value={formatMoney(customer.spent, currency)} />
        <Stat label="Owes" value={formatMoney(customer.owes, currency)} />
        <Stat label="Customer since" value={formatDate(customer.createdAt)} />
      </section>

      <div className="flex flex-wrap gap-2.5">
        <Button asChild>
          <Link href={`/invoices?compose=1&customer=${encodeURIComponent(customer.id)}`}>
            New invoice
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href={`/receipts?compose=1&customer=${encodeURIComponent(customer.id)}`}>
            New receipt
          </Link>
        </Button>
      </div>

      <Panel title="History">
        {customer.timeline.length === 0 ? (
          <p className="text-muted text-[15px]">
            No bookings, invoices, receipts or orders yet.
          </p>
        ) : (
          <ul className="grid gap-2">
            {customer.timeline.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`}>
                <TimelineRow entry={entry} currency={currency} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <CustomerEditModal
        key={editKey}
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={customer}
      />
    </div>
  );
}

/**
 * An order's status in the timeline. The entry carries no fulfilment, so Ready
 * and Done stay generic, as the Orders filter words them.
 */
const ORDER_STATUS: Record<string, { label: string; tone: "accent" | "muted" }> = {
  NEW: { label: "New", tone: "accent" },
  READY: { label: "Ready", tone: "accent" },
  COMPLETED: { label: "Done", tone: "muted" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

function TimelineRow({ entry, currency }: { entry: TimelineEntry; currency: string }) {
  const status =
    entry.kind === "order"
      ? ORDER_STATUS[entry.status]
      : entry.kind === "booking"
        ? BOOKING_STATUS[entry.status]
        : INVOICE_STATUS[entry.status];
  const body = (
    <div className="grid gap-1">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[15px] leading-snug font-semibold">{entry.label}</p>
        <span className="shrink-0 text-[15px] font-semibold tabular-nums">
          {formatMoney(entry.amount, currency)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted text-sm">{formatDate(entry.at)}</p>
        {status ? (
          <StatusPill
            tone={status.tone}
            className={status.tone === "muted" ? "bg-surface" : undefined}
          >
            {status.label}
          </StatusPill>
        ) : null}
      </div>
    </div>
  );

  if (!entry.href) {
    return <div className="rounded-card bg-canvas px-4 py-3">{body}</div>;
  }

  return (
    <a
      href={entry.href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-card bg-canvas hover:bg-accent-soft ease-out-expo block px-4 py-3 no-underline transition-colors duration-200"
    >
      {body}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border-line border px-5 py-4">
      <p className="text-muted text-sm font-semibold">{label}</p>
      <p className="font-display mt-1.5 text-[clamp(1.6rem,1.3rem+1.2vw,2.2rem)] leading-none font-[330] tracking-[-0.035em] tabular-nums">
        {value}
      </p>
    </div>
  );
}

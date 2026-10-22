"use client";

import { useState } from "react";
import type { OrderDto } from "types";

import { CopyLinkIconButton } from "@/components/copy-link-icon-button";
import { Button, Field, Input, StatusPill } from "@/primitives";
import { formatMoney } from "@/utils/format";
import { formatDate, orderStatusLabel } from "@/utils/labels";

interface OrderRowProps {
  order: OrderDto;
  /** The customer's order page. */
  link: string;
  busy: boolean;
  /** A save error to show under the address field. */
  error?: string | null;
  onAdvance: (status: "READY" | "COMPLETED") => void;
  onCancel: () => void;
  /** Saves the address; `done` closes the field once it has saved. */
  onSwitchToDelivery: (address: string, done: () => void) => void;
}

const TONE = {
  NEW: "accent",
  READY: "accent",
  COMPLETED: "muted",
  CANCELLED: "muted",
  AWAITING_PAYMENT: "muted",
} as const;

/** The next step an order can take, worded for how it leaves the business. */
function nextStep(order: OrderDto): { status: "READY" | "COMPLETED"; label: string } | null {
  if (order.status === "NEW") return { status: "READY", label: "Mark ready" };
  if (order.status === "READY") {
    return {
      status: "COMPLETED",
      label: order.fulfilment === "PICKUP" ? "Mark collected" : "Mark delivered",
    };
  }
  return null;
}

/** One paid order: what it is, who it is for, and the next thing that can happen to it. */
export function OrderRow({ order, link, busy, error, onAdvance, onCancel, onSwitchToDelivery }: OrderRowProps) {
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");

  const label = orderStatusLabel(order.status, order.fulfilment);
  const number = order.orderNumber ?? order.slug;
  const phone = order.customer?.phone ?? order.clientPhone;
  const isOpen = order.status === "NEW" || order.status === "READY";
  const step = nextStep(order);
  const canSwitch = isOpen && order.invoice !== null && order.fulfilment === "PICKUP";

  return (
    <article className="rounded-card bg-surface grid gap-4 px-4 py-4 sm:grid-cols-[112px_1fr_auto] sm:items-start sm:px-5">
      <div className="flex items-baseline gap-2 sm:block">
        <p className="text-accent-ink text-[17px] font-semibold">{number}</p>
        <p className="text-muted text-sm">{formatDate(order.createdAt)}</p>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold">{order.clientName}</h3>
          {/* Muted pills are leaf grey, the row's own ground: white keeps them visible. */}
          <StatusPill tone={TONE[order.status]} className={TONE[order.status] === "muted" ? "bg-canvas" : undefined}>
            {label}
          </StatusPill>
          {order.oversold && order.status !== "CANCELLED" ? (
            <StatusPill tone="danger">Oversold</StatusPill>
          ) : null}
        </div>

        {phone ? (
          <p className="mt-1 text-sm">
            <a className="text-ink-2 hover:text-ink underline decoration-accent-tint underline-offset-4" href={`tel:${phone}`}>
              {phone}
            </a>
          </p>
        ) : null}

        <ul className="mt-2 grid gap-0.5 text-sm">
          {order.lines.map((line) => (
            <li key={line.id}>
              {line.quantity} × {line.name}
            </li>
          ))}
        </ul>

        <p className="text-muted mt-1 text-sm">
          {order.fulfilment === "DELIVERY" ? `Delivery to ${order.deliveryAddress ?? "an address to confirm"}` : "Pickup"}
        </p>

        {order.oversold && order.status !== "CANCELLED" ? (
          <p className="text-danger mt-1 text-sm">Paid after it sold out. Restock or refund.</p>
        ) : null}

        {order.invoice ? (
          <p className="text-muted mt-1 flex flex-wrap items-center gap-x-3 text-sm">
            <span>From {order.invoice.invoiceNumber}</span>
            {canSwitch && !editing ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy}
                className="text-ink-2 hover:text-ink cursor-pointer font-semibold underline decoration-accent-tint underline-offset-4 disabled:cursor-not-allowed disabled:text-faint"
              >
                Change to delivery
              </button>
            ) : null}
          </p>
        ) : null}

        {editing ? (
          <form
            noValidate
            className="mt-3 grid max-w-md gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (address.trim()) onSwitchToDelivery(address.trim(), () => setEditing(false));
            }}
          >
            <Field
              id={`address-${order.id}`}
              label="Delivery address"
              hint="The customer has already paid, so no delivery fee is added."
              error={error ?? undefined}
            >
              <Input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                autoComplete="street-address"
                autoFocus
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="dark" isLoading={busy} disabled={busy || !address.trim()}>
                Save address
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                Not now
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:items-end">
        <p className="text-[17px] font-semibold tabular-nums">{formatMoney(order.total, order.currency)}</p>
        {/* The next step first, then Cancel, then the link to the customer's page. */}
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {step ? (
            <Button size="sm" variant="dark" onClick={() => onAdvance(step.status)} isLoading={busy}>
              {step.label}
            </Button>
          ) : null}
          {isOpen ? (
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          ) : null}
          <CopyLinkIconButton url={link} label={`Copy link to order ${number}`} />
        </div>
      </div>
    </article>
  );
}

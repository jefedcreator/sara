import type { BookingDto } from "types";

import { Button, StatusPill } from "@/primitives";
import { formatMoney, formatSlotTime } from "@/utils/format";
import { BOOKING_STATUS } from "@/utils/labels";

interface BookingRowProps {
  booking: BookingDto;
  currency: string;
  busy: boolean;
  onConfirm: () => void;
  onComplete: () => void;
  onReschedule: () => void;
  onCancel: () => void;
}

function dayLabel(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** One booking: when, what, who, and the next thing that can happen to it. */
export function BookingRow({
  booking,
  currency,
  busy,
  onConfirm,
  onComplete,
  onReschedule,
  onCancel,
}: BookingRowProps) {
  const status = BOOKING_STATUS[booking.status];
  const isOpen = booking.status === "PENDING" || booking.status === "CONFIRMED";

  return (
    <article className="rounded-card bg-surface grid gap-4 px-4 py-4 sm:grid-cols-[112px_1fr_auto] sm:items-center sm:px-5">
      <div className="flex items-baseline gap-2 sm:block">
        <p className="text-accent-ink text-[17px] font-semibold">{formatSlotTime(booking.startTime)}</p>
        <p className="text-muted text-sm">{dayLabel(booking.startTime)}</p>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold">{booking.clientName}</h3>
          {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
        </div>
        <p className="text-muted mt-0.5 text-sm">
          {booking.service.name} · {formatMoney(booking.service.price, currency)}
        </p>
        {booking.clientPhone || booking.clientEmail ? (
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {booking.clientPhone ? (
              <a className="text-ink-2 hover:text-ink underline decoration-accent-tint underline-offset-4" href={`tel:${booking.clientPhone}`}>
                {booking.clientPhone}
              </a>
            ) : null}
            {booking.clientEmail ? (
              <a className="text-ink-2 hover:text-ink truncate underline decoration-accent-tint underline-offset-4" href={`mailto:${booking.clientEmail}`}>
                {booking.clientEmail}
              </a>
            ) : null}
          </p>
        ) : null}
        {booking.notes ? <p className="text-muted mt-1 text-sm italic">“{booking.notes}”</p> : null}
      </div>

      {isOpen ? (
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {booking.status === "PENDING" ? (
            <Button size="sm" variant="dark" onClick={onConfirm} isLoading={busy}>
              Confirm
            </Button>
          ) : (
            <Button size="sm" variant="dark" onClick={onComplete} isLoading={busy}>
              Mark done
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={onReschedule} disabled={busy}>
            Reschedule
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      ) : null}
    </article>
  );
}

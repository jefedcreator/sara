"use client";

import { useQueryStates } from "nuqs";
import { useState } from "react";
import type { BookingDto, Page } from "types";

import {
  useRescheduleBookingMutation,
  useSetBookingStatusMutation,
} from "@/hooks/mutations/use-booking-status-mutations";
import { useBookingsQuery } from "@/hooks/queries/use-bookings";
import { ConfirmModal, Notice, Pager, Segmented, Skeleton } from "@/primitives";
import type { BookingListParams, BookingStatus } from "@/utils/api";
import { errorMessage } from "@/utils/axios";
import { publicPath } from "@/utils/public-links";
import { bookingListParams, bookingsParams, type BookingView } from "@/utils/url-state";

import { BookingRow } from "./booking-row";
import { RescheduleModal } from "./reschedule-modal";

const VIEWS: { value: BookingView; label: string }[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "pending", label: "Awaiting payment" },
  { value: "completed", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];

const EMPTY: Record<BookingView, string> = {
  confirmed: "No confirmed bookings. Share a booking link to get some.",
  pending: "Nobody is part-way through paying.",
  completed: "Finished bookings show here once you mark them done.",
  cancelled: "No cancelled bookings.",
  all: "No bookings yet. Share a booking link to get your first.",
};

interface BookingsPageClientProps {
  currency: string;
  publicBaseUrl: string;
  initial: { params: BookingListParams; data: Page<BookingDto> };
}

export function BookingsPageClient({ currency, publicBaseUrl, initial }: BookingsPageClientProps) {
  const [{ view, page }, setUrl] = useQueryStates(bookingsParams, { history: "push" });
  const params = bookingListParams(view, page);
  const query = useBookingsQuery(params, initial);
  const setStatus = useSetBookingStatusMutation();
  const reschedule = useRescheduleBookingMutation();

  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Kept after closing so the modals keep their content while animating out.
  const [target, setTarget] = useState<BookingDto | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveKey, setMoveKey] = useState(0);

  function changeStatus(booking: BookingDto, status: BookingStatus, onDone?: () => void) {
    setNotice(null);
    setBusySlug(booking.slug);
    setStatus.mutate(
      { slug: booking.slug, status },
      {
        onSuccess: onDone,
        onError: (error) => setNotice(errorMessage(error)),
        onSettled: () => setBusySlug(null),
      },
    );
  }

  const rows = query.data?.data ?? [];

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="font-display text-[clamp(1.9rem,1.3rem+2.2vw,3rem)] leading-[1.06] font-normal tracking-[-0.035em]">
          Bookings
        </h1>
        <p className="text-muted mt-2 max-w-[52ch] text-pretty">
          Customers book and pay through your links. Mark visits done, move them, or cancel;
          customers get an email either way.
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
            <Skeleton key={i} className="rounded-card h-[92px]" />
          ))}
        </div>
      ) : query.isError ? (
        <Notice tone="danger">Bookings didn&apos;t load. Refresh to try again.</Notice>
      ) : rows.length === 0 ? (
        <p className="rounded-card bg-surface text-muted px-5 py-6 text-[15px]">{EMPTY[view]}</p>
      ) : (
        <ul className={query.isPlaceholderData ? "grid gap-2.5 opacity-60" : "grid gap-2.5"}>
          {rows.map((booking) => (
            <li key={booking.id}>
              <BookingRow
                booking={booking}
                currency={currency}
                link={`${publicBaseUrl}${publicPath("booking", booking.publicId)}`}
                busy={busySlug === booking.slug}
                onConfirm={() => changeStatus(booking, "CONFIRMED")}
                onComplete={() => changeStatus(booking, "COMPLETED")}
                onReschedule={() => {
                  reschedule.reset();
                  setTarget(booking);
                  setMoveKey((k) => k + 1);
                  setMoveOpen(true);
                }}
                onCancel={() => {
                  setStatus.reset();
                  setTarget(booking);
                  setCancelOpen(true);
                }}
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

      {target ? (
        <RescheduleModal
          key={moveKey}
          booking={target}
          open={moveOpen}
          onOpenChange={setMoveOpen}
          isPending={reschedule.isPending}
          error={reschedule.isError ? errorMessage(reschedule.error) : null}
          onSubmit={(slot) =>
            reschedule.mutate(
              { slug: target.slug, startTime: slot.startTime, endTime: target.service.bookingMode === "SLOT" ? slot.endTime : undefined },
              { onSuccess: () => setMoveOpen(false) },
            )
          }
        />
      ) : null}

      <ConfirmModal
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={target ? `Cancel ${target.clientName}'s booking?` : "Cancel booking?"}
        description={
          setStatus.isError
            ? errorMessage(setStatus.error)
            : "They get a cancellation email, and the time opens up on your booking link. Refunds, if any, are up to you."
        }
        confirmLabel="Cancel booking"
        tone="danger"
        isPending={setStatus.isPending}
        onConfirm={() => target && changeStatus(target, "CANCELLED", () => setCancelOpen(false))}
      />
    </div>
  );
}

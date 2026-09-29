"use client";

import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useMemo, useState } from "react";
import type { PublicServiceDto, TimeSlot } from "types";

import type { BookingDetailsFormSchema } from "@/backend/validators/booking.validator";
import { useCreatePublicBookingMutation } from "@/hooks/mutations/use-booking-mutations";
import {
  publicServiceKeys,
  usePublicServiceQuery,
} from "@/hooks/queries/use-public-service";
import { Button, Notice, StatusPill, Wordmark } from "@/primitives";
import { errorMessage } from "@/utils/axios";
import {
  addDays,
  formatDuration,
  formatLongDate,
  formatMoney,
  formatSlotMoment,
  formatSlotTime,
  serviceLabel,
} from "@/utils/format";

import { DayStrip } from "./day-strip";
import { DetailsModal } from "./details-modal";
import { SlotGrid, SlotGridSkeleton } from "./slot-grid";

const DAYS_AHEAD = 14;

interface BookingPageClientProps {
  slug: string;
  today: string;
  initialService: PublicServiceDto;
}

/**
 * The customer booking page: pick a day, pick a free time, add details,
 * pay with Paystack. Owns the picked day and slot; children are pure UI.
 */
export function BookingPageClient({ slug, today, initialService }: BookingPageClientProps) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const days = useMemo(
    () => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)),
    [today],
  );

  const query = usePublicServiceQuery(slug, date, { date: today, data: initialService });
  const service = query.data ?? initialService;
  const booking = useCreatePublicBookingMutation();

  const hasOpenSlot = service.slots.some(
    (s) => s.isAvailable && new Date(s.startTime).getTime() > Date.now(),
  );
  const price = formatMoney(service.price, service.currency);
  const payText = `Pay ${price} with Paystack`;

  function pickDay(next: string) {
    setDate(next);
    setSlot(null);
  }

  function submit(values: BookingDetailsFormSchema) {
    if (!slot) return;
    booking.mutate(
      {
        serviceSlug: slug,
        startTime: slot.startTime,
        endTime: slot.endTime,
        clientName: values.clientName,
        clientEmail: values.clientEmail,
        clientPhone: values.clientPhone || undefined,
        notes: values.notes || undefined,
      },
      {
        onError: () => {
          // The slot may have just gone; show the day as it is now.
          void queryClient.invalidateQueries({
            queryKey: publicServiceKeys.detail(slug, date),
          });
        },
      },
    );
  }

  return (
    <main className="bg-canvas text-ink min-h-dvh pb-32 lg:pb-16">
      <div className="max-w-page mx-auto px-4 md:px-8">
        <header className="flex h-16 items-center">
          <p className="text-muted truncate text-[15px] font-medium">{service.businessName}</p>
        </header>

        <div className="grid gap-8 pt-4 lg:grid-cols-[1fr_460px] lg:gap-16 lg:pt-12">
          {/* The service */}
          <section aria-labelledby="service-h" className="animate-rise">
            <h1
              id="service-h"
              className="font-display max-w-[18ch] text-[clamp(2.1rem,1.4rem+3vw,3.4rem)] leading-[1.04] font-[380] tracking-[-0.035em] text-balance"
            >
              {service.name}
            </h1>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill>{price}</StatusPill>
              <StatusPill tone="muted">{formatDuration(service.duration)}</StatusPill>
            </div>
            {service.description ? (
              <p className="text-muted mt-5 max-w-[52ch] text-pretty whitespace-pre-line">
                {service.description}
              </p>
            ) : null}
            {service.image ? (
              <div className="rounded-shot bg-surface relative mt-8 aspect-[4/3] max-w-[560px] overflow-hidden outline outline-1 -outline-offset-1 outline-ink/5">
                <Image
                  src={service.image}
                  alt={service.name}
                  fill
                  sizes="(min-width: 1024px) 560px, 100vw"
                  className="object-cover"
                  priority
                />
              </div>
            ) : null}
          </section>

          {/* Day, time, pay */}
          <section
            aria-label="Book a time"
            className="rounded-panel lg:bg-canvas lg:shadow-float animate-rise-2 lg:self-start lg:px-6 lg:pt-6 lg:pb-6"
          >
            <h2 className="text-ink-2 text-sm font-semibold">Pick a day</h2>
            <div className="mt-2.5">
              <DayStrip days={days} selected={date} onSelect={pickDay} />
            </div>

            <h2 className="text-ink-2 mt-6 text-sm font-semibold">
              Free times, {formatLongDate(date)}
            </h2>
            <div className="mt-2.5">
              {query.isError && !query.data ? (
                <Notice tone="danger">
                  We couldn&apos;t load this day.{" "}
                  <button
                    type="button"
                    className="cursor-pointer font-semibold underline"
                    onClick={() => void query.refetch()}
                  >
                    Try again
                  </button>
                </Notice>
              ) : query.isPending ? (
                <SlotGridSkeleton />
              ) : !hasOpenSlot && !query.isPlaceholderData ? (
                <Notice tone="neutral">
                  No free times on this day. Try another day.
                </Notice>
              ) : (
                <SlotGrid
                  slots={service.slots}
                  selected={slot?.startTime ?? null}
                  onSelect={setSlot}
                  isStale={query.isPlaceholderData}
                />
              )}
            </div>

            {/* Phone: pinned to the bottom edge. Desktop: the card's foot. */}
            <div className="border-line bg-canvas/92 fixed inset-x-0 bottom-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:static lg:mt-6 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <p className="text-muted mb-2 text-center text-[13px] lg:hidden" aria-live="polite">
                {slot
                  ? `${formatSlotMoment(slot.startTime)} · ${price}`
                  : "Pick a free time to continue"}
              </p>
              <Button
                size="lg"
                className="w-full"
                disabled={!slot}
                onClick={() => {
                  booking.reset();
                  setDetailsOpen(true);
                }}
              >
                {slot ? `Book ${formatSlotTime(slot.startTime)}` : "Continue"}
              </Button>
            </div>
          </section>
        </div>

        <footer className="text-faint mt-16 hidden items-center gap-2 text-[13px] lg:flex">
          Bookings by <Wordmark className="text-faint text-[17px]" />
        </footer>
      </div>

      {slot ? (
        <DetailsModal
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          businessName={service.businessName}
          serviceText={serviceLabel(service)}
          slotText={formatSlotMoment(slot.startTime)}
          payText={payText}
          onSubmit={submit}
          isPending={booking.isPending || booking.isSuccess}
          error={booking.isError ? errorMessage(booking.error) : null}
        />
      ) : null}
    </main>
  );
}

"use client";

import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useState } from "react";
import type { PublicServiceDto } from "types";

import type { BookingDetailsFormSchema } from "@/backend/validators/booking.validator";
import { useCreatePublicBookingMutation } from "@/hooks/mutations/use-booking-mutations";
import { publicServiceKeys } from "@/hooks/queries/use-public-service";
import { Button, StatusPill, Wordmark } from "@/primitives";
import { errorMessage } from "@/utils/axios";
import { formatDuration, formatMoney, formatSlotTime, serviceLabel, unitCount, unitNoun } from "@/utils/format";

import { DetailsModal } from "./details-modal";
import { RentalPicker } from "./rental-picker";
import { SlotPicker } from "./slot-picker";
import { StayPicker } from "./stay-picker";
import type { Selection } from "./types";

interface BookingPageClientProps {
  slug: string;
  today: string;
  initialService: PublicServiceDto;
}

const PROMPT = {
  SLOT: "Pick a free time to continue",
  NIGHTLY: "Pick your check-in and check-out dates",
  DAILY: "Pick a pickup time to continue",
} as const;

const PANEL_LABEL = { SLOT: "Book a time", NIGHTLY: "Book your stay", DAILY: "Book your rental" } as const;

/**
 * The customer booking page: the service on the left, a picker for its
 * booking mode on the right, then details and Paystack. Owns the selection;
 * the pickers own their own day, dates or days.
 */
export function BookingPageClient({ slug, today, initialService: service }: BookingPageClientProps) {
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const booking = useCreatePublicBookingMutation();
  const mode = service.bookingMode;

  const price = formatMoney(service.price, service.currency);
  const payText = `Pay ${formatMoney(selection ? selection.total : service.price, service.currency)} with Paystack`;
  const buttonText = !selection
    ? "Continue"
    : mode === "SLOT"
      ? `Book ${formatSlotTime(selection.startTime)}`
      : `Book ${unitCount(mode, selection.units)}`;

  function submit(values: BookingDetailsFormSchema) {
    if (!selection) return;
    booking.mutate(
      {
        serviceSlug: slug,
        startTime: selection.startTime,
        ...(mode === "SLOT" ? { endTime: selection.endTime } : { units: selection.units }),
        clientName: values.clientName,
        clientEmail: values.clientEmail,
        clientPhone: values.clientPhone || undefined,
        notes: values.notes || undefined,
      },
      {
        // The time may have just gone; show availability as it is now.
        onError: () => void queryClient.invalidateQueries({ queryKey: publicServiceKeys.service(slug) }),
      },
    );
  }

  const picker = { slug, service, today, onChange: setSelection };

  return (
    <main className="bg-canvas text-ink min-h-dvh pb-32 lg:pb-16">
      <div className="max-w-page mx-auto px-4 md:px-8">
        <header className="flex h-16 items-center">
          <p className="text-muted truncate text-[15px] font-medium">{service.businessName}</p>
        </header>

        <div className="grid grid-cols-1 gap-8 pt-4 lg:grid-cols-[1fr_460px] lg:gap-16 lg:pt-12">
          {/* The service */}
          <section aria-labelledby="service-h" className="animate-rise">
            <h1
              id="service-h"
              className="font-display max-w-[18ch] text-[clamp(2.1rem,1.4rem+3vw,3.4rem)] leading-[1.04] font-[380] tracking-[-0.035em] text-balance"
            >
              {service.name}
            </h1>
            <div className="mt-4 flex flex-wrap gap-2">
              {mode === "SLOT" ? (
                <>
                  <StatusPill>{price}</StatusPill>
                  <StatusPill tone="muted">{formatDuration(service.duration)}</StatusPill>
                </>
              ) : (
                <>
                  <StatusPill>
                    {price} / {unitNoun(mode, 1)}
                  </StatusPill>
                  {mode === "NIGHTLY" ? (
                    <>
                      <StatusPill tone="muted">Check-in from {service.checkInTime}</StatusPill>
                      <StatusPill tone="muted">Check-out by {service.checkOutTime}</StatusPill>
                    </>
                  ) : service.minUnits > 1 ? (
                    <StatusPill tone="muted">Minimum {unitCount(mode, service.minUnits)}</StatusPill>
                  ) : null}
                </>
              )}
            </div>
            {service.description ? (
              <p className="text-muted mt-5 max-w-[52ch] text-pretty whitespace-pre-line">{service.description}</p>
            ) : null}
            {service.image ? (
              <div className="rounded-shot bg-surface outline-ink/5 relative mt-8 aspect-[4/3] max-w-[560px] overflow-hidden outline outline-1 -outline-offset-1">
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

          {/* Pick, then pay */}
          <section
            aria-label={PANEL_LABEL[mode]}
            className="rounded-panel lg:bg-canvas lg:shadow-float animate-rise-2 lg:self-start lg:px-6 lg:pt-6 lg:pb-6"
          >
            {mode === "NIGHTLY" ? (
              <StayPicker {...picker} />
            ) : mode === "DAILY" ? (
              <RentalPicker {...picker} />
            ) : (
              <SlotPicker {...picker} />
            )}

            {/* Phone: pinned to the bottom edge. Desktop: the card's foot. */}
            <div className="border-line bg-canvas/92 fixed inset-x-0 bottom-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:static lg:mt-6 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <p className="text-muted mb-2 text-center text-[13px] lg:hidden" aria-live="polite">
                {selection
                  ? `${selection.short} · ${formatMoney(selection.total, service.currency)}`
                  : PROMPT[mode]}
              </p>
              <Button
                size="lg"
                className="w-full"
                disabled={!selection}
                onClick={() => {
                  booking.reset();
                  setDetailsOpen(true);
                }}
              >
                {buttonText}
              </Button>
            </div>
          </section>
        </div>

        <footer className="text-faint mt-16 hidden items-center gap-2 text-[13px] lg:flex">
          Bookings by <Wordmark accent={false} className="text-faint text-[17px]" />
        </footer>
      </div>

      {selection ? (
        <DetailsModal
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          businessName={service.businessName}
          serviceText={serviceLabel(service)}
          slotText={selection.when}
          payText={payText}
          onSubmit={submit}
          isPending={booking.isPending || booking.isSuccess}
          error={booking.isError ? errorMessage(booking.error) : null}
        />
      ) : null}
    </main>
  );
}

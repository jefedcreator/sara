"use client";

import { useMemo, useState } from "react";
import type { BookingDto, TimeSlot } from "types";

import { DayStrip } from "@/components/book/day-strip";
import { SlotGrid, SlotGridSkeleton } from "@/components/book/slot-grid";
import { useServiceSlotsQuery } from "@/hooks/queries/use-bookings";
import { Button, Modal, Notice } from "@/primitives";
import { addDays, formatLongDate, formatSlotMoment, todayIso } from "@/utils/format";

interface RescheduleModalProps {
  booking: BookingDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (slot: TimeSlot) => void;
  isPending: boolean;
  error: string | null;
}

/** Move a booking to another free time. The customer is emailed the change. */
export function RescheduleModal({
  booking,
  open,
  onOpenChange,
  onSubmit,
  isPending,
  error,
}: RescheduleModalProps) {
  const today = todayIso();
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), [today]);
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const slots = useServiceSlotsQuery(booking.service.slug, date);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <Modal.Portal>
        <Modal.Content className="sm:max-w-[560px]">
          <Modal.Handle />
          <Modal.Dismiss />
          <Modal.Title>Reschedule {booking.clientName}</Modal.Title>
          <Modal.Description>
            {booking.service.name}, now {formatSlotMoment(booking.startTime)}. They&apos;ll
            get an email with the new time.
          </Modal.Description>

          <p className="text-ink-2 mt-6 text-sm font-semibold">Pick a day</p>
          <div className="mt-2.5">
            <DayStrip
              days={days}
              selected={date}
              onSelect={(next) => {
                setDate(next);
                setSlot(null);
              }}
            />
          </div>
          <p className="text-ink-2 mt-5 text-sm font-semibold">Free times, {formatLongDate(date)}</p>
          <div className="mt-2.5">
            {slots.isPending ? (
              <SlotGridSkeleton />
            ) : slots.isError || !slots.data ? (
              <Notice tone="danger">This day didn&apos;t load. Pick it again.</Notice>
            ) : (
              <SlotGrid
                slots={slots.data.slots}
                selected={slot?.startTime ?? null}
                onSelect={setSlot}
                isStale={slots.isPlaceholderData}
              />
            )}
          </div>

          {error ? (
            <Notice tone="danger" className="mt-5">
              {error}
            </Notice>
          ) : null}

          <div className="mt-6 grid gap-2.5 sm:flex sm:flex-row-reverse">
            <Button disabled={!slot} isLoading={isPending} onClick={() => slot && onSubmit(slot)}>
              {slot ? `Move to ${formatSlotMoment(slot.startTime)}` : "Pick a time"}
            </Button>
            <Modal.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Modal.Close>
          </div>
        </Modal.Content>
      </Modal.Portal>
    </Modal>
  );
}

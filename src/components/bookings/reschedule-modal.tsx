"use client";

import { useMemo, useState } from "react";
import type { BookingDto, TimeSlot } from "types";

import { DayStrip } from "@/components/book/day-strip";
import { SlotGrid, SlotGridSkeleton } from "@/components/book/slot-grid";
import { StayCalendar, type CalendarDay } from "@/components/book/stay-calendar";
import { useServiceSlotsQuery, useServiceNightsQuery, useServicePickupsQuery } from "@/hooks/queries/use-bookings";
import { Button, Modal, Notice } from "@/primitives";
import { addDays, formatLongDate, formatSlotMoment, todayIso, addMonths, bookingSpan, eachDate, monthStart, unitCount } from "@/utils/format";

interface RescheduleModalProps {
  booking: BookingDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (slot: TimeSlot) => void;
  isPending: boolean;
  error: string | null;
}

/** Move a stay: pick a new check-in; the stay keeps its nights. */
function StayMove({ booking, onPick, picked }: { booking: BookingDto; onPick: (slot: TimeSlot | null) => void; picked: string | null }) {
  const today = todayIso();
  const [month, setMonth] = useState(monthStart(today));
  const window = { from: month, to: addMonths(month, 1 + Math.ceil(booking.units / 30)) };
  const nights = useServiceNightsQuery(booking.service.slug, window.from, window.to, booking.slug, true);
  const free = new Set((nights.data?.nights ?? []).filter((n) => n.isAvailable).map((n) => n.date));
  const checkInTime = booking.startTime.slice(11, 16);
  const checkOutTime = booking.endTime.slice(11, 16);
  const pickedCheckOut = picked ? addDays(picked, booking.units) : null;

  const days: CalendarDay[] = eachDate(month, addMonths(month, 1)).map((date) => {
    const past = date < today;
    const fits = eachDate(date, addDays(date, booking.units)).every((d) => free.has(d));
    return {
      date,
      state: past ? "past" : free.has(date) ? "free" : "taken",
      selected:
        date === picked ? "start" : date === pickedCheckOut ? "end" : picked && date > picked && date < pickedCheckOut! ? "between" : null,
      selectable: !past && fits,
    };
  });

  return (
    <StayCalendar
      month={month}
      days={days}
      isStale={nights.isPlaceholderData || nights.isPending}
      onPrev={month > monthStart(today) ? () => setMonth(addMonths(month, -1)) : null}
      onNext={() => setMonth(addMonths(month, 1))}
      onPick={(date) =>
        onPick({
          startTime: `${date}T${checkInTime}:00.000Z`,
          endTime: `${addDays(date, booking.units)}T${checkOutTime}:00.000Z`,
          isAvailable: true,
        })
      }
    />
  );
}

/** Move a rental: pick a new pickup day and time; the rental keeps its days. */
function RentalMove({ booking, onPick, picked }: { booking: BookingDto; onPick: (slot: TimeSlot | null) => void; picked: string | null }) {
  const today = todayIso();
  const days = useMemo(() => Array.from({ length: 60 }, (_, i) => addDays(today, i)), [today]);
  const [date, setDate] = useState(today);
  const pickups = useServicePickupsQuery(booking.service.slug, date, booking.units, booking.slug, true);
  return (
    <>
      <DayStrip days={days} selected={date} onSelect={(next) => { setDate(next); onPick(null); }} />
      <div className="mt-4">
        {pickups.isPending ? (
          <SlotGridSkeleton />
        ) : pickups.isError || !pickups.data ? (
          <Notice tone="danger">This day didn&apos;t load. Pick it again.</Notice>
        ) : (
          <SlotGrid slots={pickups.data.slots} selected={picked} onSelect={onPick} isStale={pickups.isPlaceholderData} />
        )}
      </div>
    </>
  );
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
  // Stays and rentals load their own nights or pickup times below.
  const slots = useServiceSlotsQuery(booking.service.bookingMode === "SLOT" ? booking.service.slug : null, date);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <Modal.Portal>
        <Modal.Content className="sm:max-w-[560px]">
          <Modal.Handle />
          <Modal.Dismiss />
          <Modal.Title>Reschedule {booking.clientName}</Modal.Title>
          <Modal.Description>
            {booking.service.name}, now {booking.service.bookingMode === "SLOT" ? formatSlotMoment(booking.startTime) : bookingSpan({ bookingMode: booking.service.bookingMode, startTime: booking.startTime, endTime: booking.endTime, units: booking.units })}. {booking.service.bookingMode === "NIGHTLY" ? `Pick a new check-in; the stay keeps its ${unitCount("NIGHTLY", booking.units)}.` : "They'll get an email with the new time."}
          </Modal.Description>

          {booking.service.bookingMode === "SLOT" ? (
            <>
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
            </>
          ) : booking.service.bookingMode === "NIGHTLY" ? (
            <div className="mt-6">
              <StayMove booking={booking} picked={slot ? slot.startTime.slice(0, 10) : null} onPick={setSlot} />
            </div>
          ) : (
            <div className="mt-6">
              <RentalMove booking={booking} picked={slot?.startTime ?? null} onPick={setSlot} />
            </div>
          )}

          {error ? (
            <Notice tone="danger" className="mt-5">
              {error}
            </Notice>
          ) : null}

          <div className="mt-6 grid gap-2.5 sm:flex sm:flex-row-reverse">
            <Button disabled={!slot} isLoading={isPending} onClick={() => slot && onSubmit(slot)}>
              {slot ? `Move to ${booking.service.bookingMode === "SLOT" ? formatSlotMoment(slot.startTime) : bookingSpan({ bookingMode: booking.service.bookingMode, startTime: slot.startTime, endTime: slot.endTime, units: booking.units })}` : "Pick a time"}
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

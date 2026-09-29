"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { BusinessClosureDto } from "types";

import {
  closureFormSchema,
  type ClosureFormSchema,
} from "@/backend/validators/business.validator";
import { Button, Field, Input, Modal, Notice } from "@/primitives";
import { formatLongDate, todayIso } from "@/utils/format";

import { Section } from "./section";

interface ClosuresSectionProps {
  closures: BusinessClosureDto[];
  onAdd: (values: ClosureFormSchema, onAdded: () => void) => void;
  isAdding: boolean;
  addError: string | null;
  onRemove: (id: string) => void;
  removingId: string | null;
}

/** One-off days off. Past days are hidden; they no longer affect bookings. */
export function ClosuresSection({
  closures,
  onAdd,
  isAdding,
  addError,
  onRemove,
  removingId,
}: ClosuresSectionProps) {
  const today = todayIso();
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const upcoming = closures
    .map((c) => ({ ...c, day: c.date.slice(0, 10) }))
    .filter((c) => c.day >= today);

  return (
    <Section
      id="closures-h"
      title="Days off"
      description="Holidays and rest days. Booking links show these days as closed."
    >
      {upcoming.length === 0 ? (
        <p className="text-muted text-[15px]">No days off coming up.</p>
      ) : (
        <ul className="grid gap-2">
          {upcoming.map((closure) => (
            <li
              key={closure.id}
              className="bg-canvas rounded-card flex items-center gap-3 py-2 pr-2 pl-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{formatLongDate(closure.day)}</p>
                {closure.reason ? (
                  <p className="text-muted truncate text-sm">{closure.reason}</p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${formatLongDate(closure.day)}`}
                isLoading={removingId === closure.id}
                onClick={() => onRemove(closure.id)}
              >
                {removingId === closure.id ? null : <X weight="bold" />}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="secondary"
        size="sm"
        className="mt-5"
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <Plus weight="bold" />
        Add a day off
      </Button>

      <Modal open={open} onOpenChange={setOpen}>
        <Modal.Portal>
          <Modal.Content>
            <Modal.Handle />
            <Modal.Dismiss />
            <Modal.Title>Add a day off</Modal.Title>
            <Modal.Description>
              Nobody can book you on this day. Bookings you already have stay.
            </Modal.Description>
            <ClosureForm
              key={formKey}
              min={today}
              isPending={isAdding}
              error={addError}
              onSubmit={(values) => onAdd(values, () => setOpen(false))}
            />
          </Modal.Content>
        </Modal.Portal>
      </Modal>
    </Section>
  );
}

function ClosureForm({
  min,
  isPending,
  error,
  onSubmit,
}: {
  min: string;
  isPending: boolean;
  error: string | null;
  onSubmit: (values: ClosureFormSchema) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClosureFormSchema>({
    resolver: zodResolver(closureFormSchema),
    defaultValues: { date: "", reason: "" },
  });

  return (
    <form noValidate autoComplete="off" onSubmit={handleSubmit(onSubmit)} className="mt-6 grid gap-4">
      <Field id="closure-date" label="Date" error={errors.date?.message}>
        <Input type="date" min={min} {...register("date")} />
      </Field>
      <Field id="closure-reason" label="Reason (optional)" hint="Only you see this." error={errors.reason?.message}>
        <Input placeholder="Independence Day" {...register("reason")} />
      </Field>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="mt-2 grid gap-2.5 sm:flex sm:flex-row-reverse">
        <Button type="submit" variant="dark" isLoading={isPending}>
          Add day off
        </Button>
        <Modal.Close asChild>
          <Button variant="secondary">Cancel</Button>
        </Modal.Close>
      </div>
    </form>
  );
}

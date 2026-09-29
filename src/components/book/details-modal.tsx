"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import {
  bookingDetailsFormSchema,
  type BookingDetailsFormSchema,
} from "@/backend/validators/booking.validator";
import { ArrowDisc, Button, Field, Input, Modal, Notice, Textarea } from "@/primitives";

interface DetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessName: string;
  /** "Knotless braids — NGN 25,000 (4 hr)" */
  serviceText: string;
  /** "Mon 28 Sep at 13:00" */
  slotText: string;
  payText: string;
  onSubmit: (values: BookingDetailsFormSchema) => void;
  isPending: boolean;
  error: string | null;
}

const DEFAULTS: BookingDetailsFormSchema = {
  clientName: "",
  clientEmail: "",
  clientPhone: "",
  notes: "",
};

/** The customer's details, then off to Paystack. */
export function DetailsModal({
  open,
  onOpenChange,
  businessName,
  serviceText,
  slotText,
  payText,
  onSubmit,
  isPending,
  error,
}: DetailsModalProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BookingDetailsFormSchema>({
    resolver: zodResolver(bookingDetailsFormSchema),
    defaultValues: DEFAULTS,
  });

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <Modal.Portal>
        <Modal.Content aria-describedby="booking-summary">
          <Modal.Handle />
          <Modal.Dismiss />
          <Modal.Title>Your details</Modal.Title>
          <div
            id="booking-summary"
            className="rounded-card bg-surface mt-4 px-4 py-3 text-[15px]"
          >
            <p className="font-semibold">{serviceText}</p>
            <p className="text-muted mt-0.5">
              {slotText} with {businessName}
            </p>
          </div>

          <form
            noValidate
            onSubmit={handleSubmit(onSubmit)}
            className="mt-5 grid gap-4"
          >
            <Field id="clientName" label="Name" error={errors.clientName?.message}>
              <Input autoComplete="name" {...register("clientName")} />
            </Field>
            <Field
              id="clientEmail"
              label="Email"
              hint="Your confirmation and reminder go here."
              error={errors.clientEmail?.message}
            >
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                {...register("clientEmail")}
              />
            </Field>
            <Field
              id="clientPhone"
              label="Phone (optional)"
              hint={`So ${businessName} can reach you.`}
              error={errors.clientPhone?.message}
            >
              <Input type="tel" inputMode="tel" autoComplete="tel" {...register("clientPhone")} />
            </Field>
            <Field id="notes" label="Notes (optional)" error={errors.notes?.message}>
              <Textarea rows={2} {...register("notes")} />
            </Field>

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <Button type="submit" size="lg" isLoading={isPending} className="mt-1 w-full justify-between pr-2">
              {isPending ? "Opening Paystack…" : payText}
              {isPending ? null : <ArrowDisc />}
            </Button>
            <p className="text-muted -mt-1 text-center text-[13px]">
              Payment is handled by Paystack. You come back here afterwards.
            </p>
          </form>
        </Modal.Content>
      </Modal.Portal>
    </Modal>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import type { InvoiceDto } from "types";

import {
  paymentFormSchema,
  type PaymentFormSchema,
} from "@/backend/validators/document-form.validator";
import { Button, Field, Input, Modal, Notice, Select } from "@/primitives";
import { formatMoney } from "@/utils/format";

interface PaymentModalProps {
  invoice: InvoiceDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PaymentFormSchema) => void;
  isPending: boolean;
  error: string | null;
}

export function outstandingOf(invoice: Pick<InvoiceDto, "total" | "amountPaid">) {
  return Math.max(0, Number(invoice.total) - Number(invoice.amountPaid));
}

/** Money received against an invoice, in full or in part. */
export function PaymentModal({
  invoice,
  open,
  onOpenChange,
  onSubmit,
  isPending,
  error,
}: PaymentModalProps) {
  const outstanding = outstandingOf(invoice);
  const schema = useMemo(() => paymentFormSchema(outstanding), [outstanding]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PaymentFormSchema>({
    resolver: zodResolver(schema),
    defaultValues: { amount: String(outstanding), paymentMethod: "CASH", withReceipt: true },
  });

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <Modal.Portal>
        <Modal.Content>
          <Modal.Handle />
          <Modal.Dismiss />
          <Modal.Title>Record a payment</Modal.Title>
          <Modal.Description>
            {invoice.invoiceNumber} for {invoice.clientName}:{" "}
            {formatMoney(outstanding, invoice.currency)} still owed.
          </Modal.Description>
          <form noValidate autoComplete="off" onSubmit={handleSubmit(onSubmit)} className="mt-6 grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Field
                id="payment-amount"
                label={`Amount (${invoice.currency})`}
                hint="Less than the full amount marks it part-paid."
                error={errors.amount?.message}
              >
                <Input inputMode="decimal" {...register("amount")} />
              </Field>
              <Field id="payment-method" label="Paid by">
                <Select {...register("paymentMethod")}>
                  <option value="CASH">Cash</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                </Select>
              </Field>
            </div>
            <label className="flex cursor-pointer items-center gap-3 text-[15px]">
              <input
                type="checkbox"
                className="accent-accent-ink size-5 cursor-pointer"
                {...register("withReceipt")}
              />
              Also make a receipt for this payment
            </label>
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <div className="mt-2 grid gap-2.5 sm:flex sm:flex-row-reverse">
              <Button type="submit" isLoading={isPending}>
                Record payment
              </Button>
              <Modal.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </Modal.Close>
            </div>
          </form>
        </Modal.Content>
      </Modal.Portal>
    </Modal>
  );
}

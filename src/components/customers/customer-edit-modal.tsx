"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import type { CustomerDetail, CustomerListItem } from "types";
import { z } from "zod";

import { useMergeCustomersMutation, useUpdateCustomerMutation } from "@/hooks/mutations/use-customer-mutations";
import { useCustomersQuery } from "@/hooks/queries/use-customers";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { Button, ConfirmModal, Field, Input, Modal, Notice, Skeleton, Textarea } from "@/primitives";
import { errorMessage } from "@/utils/axios";

const customerFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter the customer's name")
      .max(255, "Keep the name under 255 characters"),
    phone: z.string().trim().max(50, "Keep the phone under 50 characters"),
    email: z
      .string()
      .trim()
      .max(255, "Keep the email under 255 characters")
      .refine((value) => value === "" || z.string().email().safeParse(value).success, {
        message: "Enter a valid email, like ada@example.com",
      }),
    address: z.string().trim().max(1000, "Keep the address under 1,000 characters"),
    notes: z.string().trim().max(2000, "Keep the notes under 2,000 characters"),
  })
  .strict();

type CustomerFormValues = z.infer<typeof customerFormSchema>;

function toFormValues(customer: CustomerDetail): CustomerFormValues {
  return {
    name: customer.name,
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    address: customer.address ?? "",
    notes: customer.notes ?? "",
  };
}

interface CustomerEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CustomerDetail;
}

/**
 * Edit one customer's details, or fold another customer into them. Merging
 * lives at the sheet's foot because it is rare and cannot be undone.
 */
export function CustomerEditModal({ open, onOpenChange, customer }: CustomerEditModalProps) {
  const update = useUpdateCustomerMutation();
  const merge = useMergeCustomersMutation();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<CustomerListItem | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: toFormValues(customer),
  });

  function save(values: CustomerFormValues) {
    update.mutate(
      {
        id: customer.id,
        values: {
          name: values.name,
          phone: values.phone || null,
          email: values.email || null,
          address: values.address || null,
          notes: values.notes || null,
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  function confirmMerge() {
    if (!mergeTarget) return;
    merge.mutate(
      { keepId: customer.id, mergeId: mergeTarget.id },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange}>
        <Modal.Portal>
          <Modal.Content className="sm:max-w-[540px]">
            <Modal.Handle />
            <Modal.Dismiss />
            <Modal.Title>Edit details</Modal.Title>
            <Modal.Description>
              Changes show on their page and on new documents straight away.
            </Modal.Description>

            <form noValidate autoComplete="off" onSubmit={handleSubmit(save)} className="mt-6 grid gap-4">
              <Field id="customer-name" label="Name" error={errors.name?.message}>
                <Input placeholder="Tolu Adeyemi" {...register("name")} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="customer-phone" label="Phone (optional)" error={errors.phone?.message}>
                  <Input type="tel" inputMode="tel" placeholder="0803 555 0142" {...register("phone")} />
                </Field>
                <Field id="customer-email" label="Email (optional)" error={errors.email?.message}>
                  <Input type="email" inputMode="email" placeholder="tolu@example.com" {...register("email")} />
                </Field>
              </div>

              <Field id="customer-address" label="Address (optional)" error={errors.address?.message}>
                <Textarea rows={2} placeholder="Where you deliver or visit" {...register("address")} />
              </Field>

              <Field id="customer-notes" label="Notes (optional)" error={errors.notes?.message}>
                <Textarea rows={2} placeholder="Allergies, preferences, anything to remember" {...register("notes")} />
              </Field>

              {update.isError ? <Notice tone="danger">{errorMessage(update.error)}</Notice> : null}

              <div className="mt-2 grid gap-2.5 sm:flex sm:flex-row-reverse">
                <Button type="submit" isLoading={update.isPending}>
                  Save changes
                </Button>
                <Modal.Close asChild>
                  <Button variant="secondary">Cancel</Button>
                </Modal.Close>
              </div>
            </form>

            <div className="border-line mt-6 border-t pt-5">
              {mergeOpen ? (
                <MergeSearch
                  excludeId={customer.id}
                  keepName={customer.name}
                  onPick={(target) => {
                    merge.reset();
                    setMergeTarget(target);
                    setConfirmOpen(true);
                  }}
                  onCancel={() => {
                    setMergeOpen(false);
                    setMergeTarget(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setMergeOpen(true)}
                  className="text-muted hover:text-ink cursor-pointer text-sm font-semibold underline decoration-line underline-offset-4 transition-colors duration-200"
                >
                  Merge with another customer…
                </button>
              )}
            </div>
          </Modal.Content>
        </Modal.Portal>
      </Modal>

      <ConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          mergeTarget
            ? `Merge ${mergeTarget.name} into ${customer.name}?`
            : "Merge customers?"
        }
        description={
          merge.isError
            ? errorMessage(merge.error)
            : mergeTarget
              ? `Their bookings, invoices, receipts and orders move to ${customer.name}.`
              : ""
        }
        confirmLabel="Merge customers"
        tone="danger"
        isPending={merge.isPending}
        onConfirm={confirmMerge}
      />
    </>
  );
}

function MergeSearch({
  excludeId,
  keepName,
  onPick,
  onCancel,
}: {
  excludeId: string;
  keepName: string;
  onPick: (customer: CustomerListItem) => void;
  onCancel: () => void;
}) {
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term, 250);
  const searchTerm = debounced.trim();
  const matches = useCustomersQuery(
    { query: searchTerm || undefined, page: 1 },
    undefined,
    { enabled: searchTerm.length >= 2 },
  );
  const rows = (matches.data?.data ?? [])
    .filter((customer) => customer.id !== excludeId)
    .slice(0, 6);

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="merge-customer" className="text-ink-2 text-sm leading-[1.3] font-semibold">
          Find the other customer
        </label>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted hover:text-ink cursor-pointer text-[13px] font-semibold"
        >
          Cancel
        </button>
      </div>
      <Input
        id="merge-customer"
        type="search"
        autoFocus
        autoComplete="off"
        placeholder="Name, phone or email"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />
      <p className="text-muted text-[13px] leading-snug">
        Their bookings, invoices, receipts and orders move to {keepName}.
      </p>

      {searchTerm.length < 2 ? (
        <p className="text-muted text-[13px]">Type at least 2 characters.</p>
      ) : matches.isError ? (
        <Notice tone="danger">{errorMessage(matches.error)}</Notice>
      ) : matches.isFetching && rows.length === 0 ? (
        <Skeleton className="rounded-card h-14" />
      ) : rows.length === 0 ? (
        <p className="text-muted text-[13px]">No customer matches that.</p>
      ) : (
        <ul className="border-line divide-line rounded-card max-h-56 divide-y overflow-y-auto border">
          {rows.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => onPick(customer)}
                className="hover:bg-surface flex w-full cursor-pointer flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors duration-150"
              >
                <span className="text-[14px] font-semibold">{customer.name}</span>
                <span className="text-muted text-[13px]">
                  {customer.phone ?? customer.email ?? "No contact details"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash } from "@phosphor-icons/react/dist/ssr";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import type { ServiceDto } from "types";

import {
  documentFormSchema,
  type DocumentFormSchema,
} from "@/backend/validators/document-form.validator";
import { CopyLinkButton } from "@/app/components/landing/CopyLinkButton";
import {
  Button,
  DatePicker,
  Field,
  Input,
  Modal,
  Notice,
  Segmented,
  Select,
  Textarea,
} from "@/primitives";
import { cn } from "@/utils/cn";
import { computeTotals } from "@/utils/documents";
import { formatMoney, todayIso } from "@/utils/format";

export type DocumentKind = "invoice" | "receipt";

export type CreatedDocument = {
  number: string;
  /** The customer's link: a page with the document's own preview card. */
  shareUrl: string;
  /** The PDF, once rendered. */
  url: string | null;
  total: number;
  customer: string;
};

interface DocumentModalProps {
  kind: DocumentKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  services: ServiceDto[];
  currency: string;
  onSubmit: (values: DocumentFormSchema, options: { draft: boolean }) => void;
  isPending: boolean;
  error: string | null;
  /** Set once saved: the modal turns into the share view. */
  created: CreatedDocument | null;
}

const COPY: Record<DocumentKind, { title: string; description: string; submit: string }> = {
  invoice: {
    title: "New invoice",
    description: "Sara makes the PDF. Share its link with your customer.",
    submit: "Create invoice",
  },
  receipt: {
    title: "New receipt",
    description: "For money you've already received. Sara makes the PDF.",
    submit: "Create receipt",
  },
};

function emptyValues(services: ServiceDto[]): DocumentFormSchema {
  const first = services[0];
  return {
    name: "",
    email: "",
    phone: "",
    mode: first ? "services" : "amount",
    items: first
      ? [{ serviceId: first.id, quantity: "1", unitPrice: String(Number(first.price)) }]
      : [],
    amount: "",
    description: "",
    taxAmount: "",
    discount: "",
    dueAt: "",
    paymentMethod: "CASH",
  };
}

/**
 * Create an invoice or a receipt: customer, then either services from the
 * owner's list or one custom amount (what the chat does), then tax and
 * discount. The parent remounts it (by key) for each new document.
 */
export function DocumentModal({
  kind,
  open,
  onOpenChange,
  services,
  currency,
  onSubmit,
  isPending,
  error,
  created,
}: DocumentModalProps) {
  const copy = COPY[kind];
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<DocumentFormSchema>({
    resolver: zodResolver(documentFormSchema),
    defaultValues: emptyValues(services),
  });
  const items = useFieldArray({ control, name: "items" });
  const values = useWatch({ control });
  const mode = values.mode ?? "amount";
  const totals = computeTotals({
    mode,
    items: (values.items ?? []).map((item) => ({
      serviceId: item?.serviceId ?? "",
      quantity: item?.quantity ?? "",
      unitPrice: item?.unitPrice ?? "",
    })),
    amount: values.amount ?? "",
    taxAmount: values.taxAmount ?? "",
    discount: values.discount ?? "",
  });

  const submit = (draft: boolean) => handleSubmit((form) => onSubmit(form, { draft }));

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <Modal.Portal>
        <Modal.Content className="sm:max-w-[600px]">
          <Modal.Handle />
          <Modal.Dismiss />
          {created ? (
            <CreatedView kind={kind} created={created} currency={currency} />
          ) : (
            <>
              <Modal.Title>{copy.title}</Modal.Title>
              <Modal.Description>{copy.description}</Modal.Description>

              <form
                noValidate
                autoComplete="off"
                onSubmit={submit(false)}
                className="mt-6 grid gap-5"
              >
                <Field id={`${kind}-name`} label="Customer" error={errors.name?.message}>
                  <Input placeholder="Funke Bello" {...register("name")} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`${kind}-email`} label="Email (optional)" error={errors.email?.message}>
                    <Input type="email" inputMode="email" {...register("email")} />
                  </Field>
                  <Field id={`${kind}-phone`} label="Phone (optional)" error={errors.phone?.message}>
                    <Input type="tel" inputMode="tel" {...register("phone")} />
                  </Field>
                </div>

                <div className="grid gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-ink-2 text-sm font-semibold">What for</p>
                    {services.length > 0 ? (
                      <Segmented
                        label="What for"
                        value={mode}
                        options={[
                          { value: "services", label: "Services" },
                          { value: "amount", label: "Custom amount" },
                        ]}
                        onChange={(next) => setValue("mode", next, { shouldValidate: false })}
                      />
                    ) : null}
                  </div>

                  {mode === "services" ? (
                    <div className="grid gap-3">
                      {items.fields.map((field, index) => {
                        const rowErrors = errors.items?.[index];
                        return (
                          <div
                            key={field.id}
                            className="bg-surface rounded-card grid grid-cols-[1fr_72px] gap-2.5 p-3 sm:grid-cols-[1fr_72px_120px_auto] sm:items-start"
                          >
                            <Field
                              id={`${kind}-item-${index}-service`}
                              label="Service"
                              error={rowErrors?.serviceId?.message}
                              className="col-span-2 sm:col-span-1"
                            >
                              <Controller
                                control={control}
                                name={`items.${index}.serviceId`}
                                render={({ field: serviceField }) => (
                                  <Select
                                    ref={serviceField.ref}
                                    value={serviceField.value}
                                    onValueChange={(serviceId) => {
                                      serviceField.onChange(serviceId);
                                      const service = services.find((s) => s.id === serviceId);
                                      if (service) {
                                        setValue(`items.${index}.unitPrice`, String(Number(service.price)));
                                      }
                                    }}
                                    placeholder="Pick a service"
                                  >
                                    {services.map((service) => (
                                      <Select.Item key={service.id} value={service.id}>
                                        {service.name}
                                      </Select.Item>
                                    ))}
                                  </Select>
                                )}
                              />
                            </Field>
                            <Field
                              id={`${kind}-item-${index}-qty`}
                              label="Qty"
                              error={rowErrors?.quantity?.message}
                            >
                              <Input inputMode="numeric" {...register(`items.${index}.quantity`)} />
                            </Field>
                            <Field
                              id={`${kind}-item-${index}-price`}
                              label={`Price (${currency})`}
                              error={rowErrors?.unitPrice?.message}
                            >
                              <Input inputMode="decimal" {...register(`items.${index}.unitPrice`)} />
                            </Field>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="self-end sm:mt-[26px]"
                              aria-label="Remove this line"
                              onClick={() => items.remove(index)}
                            >
                              <Trash weight="bold" />
                            </Button>
                          </div>
                        );
                      })}
                      {errors.items?.message ? (
                        <p className="text-danger text-[13px]">{errors.items.message}</p>
                      ) : null}
                      <Button
                        variant="secondary"
                        size="sm"
                        className="justify-self-start"
                        onClick={() => {
                          const unused =
                            services.find(
                              (s) => !(values.items ?? []).some((i) => i?.serviceId === s.id),
                            ) ?? services[0];
                          if (!unused) return;
                          items.append({
                            serviceId: unused.id,
                            quantity: "1",
                            unitPrice: String(Number(unused.price)),
                          });
                        }}
                      >
                        <Plus weight="bold" />
                        Add a line
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
                      <Field id={`${kind}-amount`} label={`Amount (${currency})`} error={errors.amount?.message}>
                        <Input inputMode="decimal" placeholder="15000" {...register("amount")} />
                      </Field>
                      <Field id={`${kind}-description`} label="Description (optional)" error={errors.description?.message}>
                        <Input placeholder="Wig install and styling" {...register("description")} />
                      </Field>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field id={`${kind}-tax`} label="Tax (optional)" error={errors.taxAmount?.message}>
                    <Input inputMode="decimal" placeholder="0" {...register("taxAmount")} />
                  </Field>
                  <Field id={`${kind}-discount`} label="Discount (optional)" error={errors.discount?.message}>
                    <Input inputMode="decimal" placeholder="0" {...register("discount")} />
                  </Field>
                </div>

                {kind === "invoice" ? (
                  <Field id="invoice-due" label="Due date (optional)">
                    <Controller
                      control={control}
                      name="dueAt"
                      render={({ field }) => (
                        <DatePicker
                          ref={field.ref}
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          min={todayIso()}
                          placeholder="No due date"
                          clearable
                        />
                      )}
                    />
                  </Field>
                ) : (
                  <Field id="receipt-method" label="Paid by">
                    <Controller
                      control={control}
                      name="paymentMethod"
                      render={({ field }) => (
                        <Select ref={field.ref} value={field.value} onValueChange={field.onChange}>
                          <Select.Item value="CASH">Cash</Select.Item>
                          <Select.Item value="BANK_TRANSFER">Bank transfer</Select.Item>
                        </Select>
                      )}
                    />
                  </Field>
                )}

                {mode === "services" ? (
                  <Field id={`${kind}-notes`} label="Notes (optional)" error={errors.description?.message}>
                    <Textarea rows={2} {...register("description")} />
                  </Field>
                ) : null}

                <dl className="border-line grid gap-1 border-t pt-4 text-[15px]">
                  <Line label="Subtotal" value={formatMoney(totals.subtotal, currency)} />
                  {totals.taxAmount > 0 ? (
                    <Line label="Tax" value={formatMoney(totals.taxAmount, currency)} soft />
                  ) : null}
                  {totals.discount > 0 ? (
                    <Line label="Discount" value={`− ${formatMoney(totals.discount, currency)}`} soft />
                  ) : null}
                  <Line label="Total" value={formatMoney(totals.total, currency)} strong />
                </dl>

                {error ? <Notice tone="danger">{error}</Notice> : null}

                <div className="grid gap-2.5 sm:flex sm:flex-row-reverse">
                  <Button type="submit" isLoading={isPending}>
                    {copy.submit}
                  </Button>
                  {kind === "invoice" ? (
                    <Button variant="secondary" disabled={isPending} onClick={submit(true)}>
                      Save as draft
                    </Button>
                  ) : (
                    <Modal.Close asChild>
                      <Button variant="secondary">Cancel</Button>
                    </Modal.Close>
                  )}
                </div>
              </form>
            </>
          )}
        </Modal.Content>
      </Modal.Portal>
    </Modal>
  );
}

function Line({
  label,
  value,
  soft = false,
  strong = false,
}: {
  label: string;
  value: string;
  soft?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-4",
        soft && "text-muted text-sm",
        strong && "text-[17px] font-semibold",
      )}
    >
      <dt>{label}</dt>
      <dd className="whitespace-nowrap">{value}</dd>
    </div>
  );
}

/** The saved document, ready to share: what the chat replies with. */
function CreatedView({
  kind,
  created,
  currency,
}: {
  kind: DocumentKind;
  created: CreatedDocument;
  currency: string;
}) {
  const noun = kind === "invoice" ? "Invoice" : "Receipt";
  return (
    <div>
      <Modal.Title>
        {noun} {created.number} is ready.
      </Modal.Title>
      <Modal.Description>
        {formatMoney(created.total, currency)} for {created.customer}.{" "}
        {kind === "invoice" ? "Send the link so they can see what they owe." : "Send the link as their proof of payment."}
      </Modal.Description>
      <div className="bg-surface mt-6 flex items-center gap-2 rounded-full py-1 pr-1 pl-4">
        <code className="text-ink min-w-0 flex-1 truncate font-mono text-[13px]">{created.shareUrl}</code>
        <CopyLinkButton url={created.shareUrl} />
      </div>
      <div className="mt-6 grid gap-2.5 sm:flex sm:flex-row-reverse">
        {created.url ? (
          <Button asChild variant="dark">
            <a href={created.url} target="_blank" rel="noopener">
              Open PDF
            </a>
          </Button>
        ) : null}
        <Modal.Close asChild>
          <Button variant="secondary">Done</Button>
        </Modal.Close>
      </div>
    </div>
  );
}

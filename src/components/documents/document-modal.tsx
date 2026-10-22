"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash, Warning } from "@phosphor-icons/react/dist/ssr";
import { useMemo, useState, type ReactNode } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import type {
  CustomerListItem,
  InvoiceDto,
  ProductDto,
  ReceiptDto,
  ServiceDto,
} from "types";

import {
  documentFormSchema,
  type DocumentFormSchema,
} from "@/backend/validators/document-form.validator";
import { CopyLinkButton } from "@/app/components/landing/CopyLinkButton";
import { optionLabel } from "@/utils/labels";
import { useCustomersQuery } from "@/hooks/queries/use-customers";
import { useProductsQuery } from "@/hooks/queries/use-products";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { lineStockWarning } from "@/hooks/use-document-composer";
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
import { computeTotals, documentToFormValues, hasProductLine } from "@/utils/documents";
import { formatMoney, todayIso } from "@/utils/format";
import { stockBadge } from "@/utils/stock";

export type DocumentKind = "invoice" | "receipt";

export type CustomerPrefill = Pick<CustomerListItem, "id" | "name" | "phone" | "email">;

export type DocumentSubmitOptions = {
  draft: boolean;
  customerId?: string;
};

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
  onSubmit: (values: DocumentFormSchema, options: DocumentSubmitOptions) => void;
  isPending: boolean;
  error: string | null;
  /** Set once saved: the modal turns into the share view. */
  created: CreatedDocument | null;
  editing?: InvoiceDto | ReceiptDto | null;
  /** A customer chosen before opening, from their page. */
  customer?: CustomerPrefill | null;
}

const COPY: Record<
  DocumentKind,
  { title: string; description: string; submit: string }
> = {
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

/** One thing the item picker can put on a line: a service or a product option. */
type PickerChoice = {
  /** `service:<id>` or `product:<optionId>`: one value for the Select. */
  key: string;
  label: string;
  price: number;
  /** Products: the price and stock under the name. */
  meta?: ReactNode;
};

const productKey = (optionId: string) => `product:${optionId}`;
const serviceKey = (serviceId: string) => `service:${serviceId}`;

/** The picker value for a form row. */
function rowKey(item: { serviceId?: string; productOptionId?: string } | undefined) {
  if (item?.serviceId) return serviceKey(item.serviceId);
  if (item?.productOptionId) return productKey(item.productOptionId);
  return "";
}

/** Every active option of every active product, in the owner's order. */
function productChoices(products: ProductDto[], currency: string): PickerChoice[] {
  return products
    .filter((product) => product.isActive)
    .flatMap((product) =>
      product.options
        .filter((option) => option.isActive)
        .map((option) => {
          const price = Number(option.price ?? product.price);
          const badge = stockBadge(product.tracksStock, option.stock);
          return {
            key: productKey(option.id),
            label: optionLabel(product.name, option.name),
            price,
            meta: (
              <>
                {formatMoney(price, currency)} ·{" "}
                <span
                  className={cn(
                    (badge.tone === "out" || badge.tone === "low") &&
                      "text-ink-2 font-semibold",
                  )}
                >
                  {badge.label}
                </span>
              </>
            ),
          };
        }),
    );
}

function emptyValues(services: ServiceDto[], customer?: CustomerPrefill | null): DocumentFormSchema {
  const first = services[0];
  return {
    name: customer?.name ?? "",
    email: customer?.email ?? "",
    phone: customer?.phone ?? "",
    mode: first ? "services" : "amount",
    items: first
      ? [
          {
            serviceId: first.id,
            quantity: "1",
            unitPrice: String(Number(first.price)),
          },
        ]
      : [],
    amount: "",
    description: "",
    taxAmount: "",
    discount: "",
    dueAt: "",
    paymentMethod: "CASH",
    isDelivery: false,
    deliveryAddress: "",
  };
}

/**
 * Create an invoice or a receipt: customer, then either services and products
 * from the owner's lists or one custom amount (what the chat does), then tax and
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
  editing,
  customer,
}: DocumentModalProps) {
  const copy = COPY[kind];
  const [customerId, setCustomerId] = useState<string | undefined>(
    editing?.customerId ?? customer?.id,
  );
  const [selectedCustomer, setSelectedCustomer] = useState<Pick<CustomerPrefill, "id" | "name"> | null>(
    customer ? { id: customer.id, name: customer.name } : null,
  );
  const [looking, setLooking] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<DocumentFormSchema>({
    resolver: zodResolver(documentFormSchema),
    defaultValues: editing
      ? documentToFormValues(editing, kind)
      : emptyValues(services, customer),
  });
  const items = useFieldArray({ control, name: "items" });
  const values = useWatch({ control });
  const productsQuery = useProductsQuery();
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const productPicks = useMemo(() => productChoices(products, currency), [products, currency]);
  const choices = useMemo<PickerChoice[]>(
    () => [
      ...services.map((service) => ({
        key: serviceKey(service.id),
        label: service.name,
        price: Number(service.price),
      })),
      ...productPicks,
    ],
    [services, productPicks],
  );
  const hasProducts = productPicks.length > 0;
  const canItemize = services.length > 0 || hasProducts;
  const mode = values.mode ?? "amount";
  const nameValue = values.name ?? "";
  const debouncedName = useDebouncedValue(nameValue.trim(), 250);
  const customerMatches = useCustomersQuery(
    { query: debouncedName || undefined, page: 1 },
    undefined,
    { enabled: looking && debouncedName.length >= 2 },
  );
  const matches = customerMatches.data?.data ?? [];
  const totals = computeTotals({
    mode,
    items: (values.items ?? []).map((item) => ({
      serviceId: item?.serviceId ?? "",
      productOptionId: item?.productOptionId,
      name: item?.name,
      quantity: item?.quantity ?? "",
      unitPrice: item?.unitPrice ?? "",
    })),
    amount: values.amount ?? "",
    taxAmount: values.taxAmount ?? "",
    discount: values.discount ?? "",
  });

  // A new receipt that sells products can be delivered, and warns when it sells more than is in stock.
  const sellsProducts = hasProductLine({
    mode,
    items: (values.items ?? []).map((item) => ({ productOptionId: item?.productOptionId })),
  });
  const isNewReceipt = kind === "receipt" && !editing;

  const submit = (draft: boolean) =>
    handleSubmit((form) => onSubmit(form, { draft, customerId }));

  function chooseCustomer(next: CustomerListItem) {
    setValue("name", next.name, { shouldValidate: true, shouldDirty: true });
    setValue("email", next.email ?? "", { shouldDirty: true });
    setValue("phone", next.phone ?? "", { shouldDirty: true });
    setCustomerId(next.id);
    setSelectedCustomer({ id: next.id, name: next.name });
    setLooking(false);
  }

  const docNumber = editing
    ? "invoiceNumber" in editing
      ? editing.invoiceNumber
      : editing.receiptNumber
    : null;

  const title = editing
    ? `Edit ${kind === "invoice" ? "invoice" : "receipt"} ${docNumber}`
    : copy.title;
  const description = editing
    ? `Update ${kind === "invoice" ? "invoice details, line items, or customer information." : "receipt details or line items."}`
    : copy.description;

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
              <Modal.Title>{title}</Modal.Title>
              <Modal.Description>{description}</Modal.Description>

              <form
                noValidate
                autoComplete="off"
                onSubmit={submit(false)}
                className="mt-6 grid grid-cols-1 gap-5"
              >
                <Field
                  id={`${kind}-name`}
                  label="Customer"
                  hint={
                    selectedCustomer
                      ? `Using ${selectedCustomer.name}'s saved details.`
                      : "Type to find a saved customer, or enter a new name."
                  }
                  error={errors.name?.message}
                >
                  <div
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        setLooking(false);
                      }
                    }}
                  >
                    <Input
                      autoComplete="off"
                      placeholder="Funke Bello"
                      {...register("name", {
                        onChange: () => {
                          setCustomerId(undefined);
                          setSelectedCustomer(null);
                        },
                      })}
                      onFocus={() => setLooking(true)}
                    />
                    {looking && debouncedName.length >= 2 ? (
                      <div className="border-line bg-canvas rounded-card shadow-bubble mt-1 overflow-hidden border">
                        {customerMatches.isFetching && matches.length === 0 ? (
                          <p className="text-muted px-3.5 py-2.5 text-[13px]">Searching…</p>
                        ) : customerMatches.isError ? (
                          <p className="text-danger px-3.5 py-2.5 text-[13px]">
                            Couldn&apos;t search customers.
                          </p>
                        ) : matches.length === 0 ? (
                          <p className="text-muted px-3.5 py-2.5 text-[13px]">
                            No saved customer matches.
                          </p>
                        ) : (
                          <ul className="divide-line max-h-56 divide-y overflow-y-auto">
                            {matches.map((match) => (
                              <li key={match.id}>
                                <button
                                  type="button"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => chooseCustomer(match)}
                                  className="hover:bg-surface flex w-full cursor-pointer flex-col items-start gap-0.5 px-3.5 py-2.5 text-left transition-colors duration-150"
                                >
                                  <span className="text-ink text-[14px] font-semibold">
                                    {match.name}
                                  </span>
                                  <span className="text-muted max-w-full truncate text-[13px]">
                                    {match.phone ?? match.email ?? "No contact details"}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </div>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    id={`${kind}-email`}
                    label="Email (optional)"
                    error={errors.email?.message}
                  >
                    <Input
                      type="email"
                      inputMode="email"
                      {...register("email")}
                    />
                  </Field>
                  <Field
                    id={`${kind}-phone`}
                    label="Phone (optional)"
                    error={errors.phone?.message}
                  >
                    <Input type="tel" inputMode="tel" {...register("phone")} />
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-ink-2 text-sm font-semibold">What for</p>
                    {canItemize ? (
                      <Segmented
                        label="What for"
                        value={mode}
                        options={[
                          { value: "services", label: hasProducts ? "Items" : "Services" },
                          { value: "amount", label: "Custom amount" },
                        ]}
                        onChange={(next) =>
                          setValue("mode", next, { shouldValidate: false })
                        }
                      />
                    ) : null}
                  </div>

                  {mode === "services" ? (
                    <div className="grid grid-cols-1 gap-3">
                      {items.fields.map((field, index) => {
                        const rowErrors = errors.items?.[index];
                        const row = values.items?.[index];
                        const current = rowKey(row);
                        const stockNote = isNewReceipt
                          ? lineStockWarning(
                              {
                                productOptionId: row?.productOptionId,
                                quantity: row?.quantity ?? "",
                              },
                              products,
                            )
                          : null;
                        return (
                          // Phones: the item on its own line, then qty, price and remove.
                          <div
                            key={field.id}
                            className="bg-surface rounded-card grid grid-cols-[72px_minmax(0,1fr)_auto] gap-2.5 p-3 sm:grid-cols-[minmax(0,1fr)_72px_120px_auto] sm:items-start"
                          >
                            <Field
                              id={`${kind}-item-${index}-service`}
                              label={hasProducts ? "Item" : "Service"}
                              error={rowErrors?.serviceId?.message}
                              className="col-span-3 sm:col-span-1"
                            >
                              <Controller
                                control={control}
                                name={`items.${index}.serviceId`}
                                render={({ field: serviceField }) => (
                                  <Select
                                    ref={serviceField.ref}
                                    value={current}
                                    onValueChange={(next) => {
                                      const choice = choices.find((c) => c.key === next);
                                      if (!choice) return;
                                      const isProduct = next.startsWith("product:");
                                      const id = next.slice(next.indexOf(":") + 1);
                                      serviceField.onChange(isProduct ? "" : id);
                                      setValue(
                                        `items.${index}.productOptionId`,
                                        isProduct ? id : undefined,
                                      );
                                      setValue(
                                        `items.${index}.name`,
                                        isProduct ? choice.label : "",
                                      );
                                      setValue(
                                        `items.${index}.unitPrice`,
                                        String(choice.price),
                                      );
                                    }}
                                    placeholder={
                                      hasProducts ? "Pick a service or product" : "Pick a service"
                                    }
                                  >
                                    {services.map((service) => (
                                      <Select.Item
                                        key={service.id}
                                        value={serviceKey(service.id)}
                                      >
                                        {service.name}
                                      </Select.Item>
                                    ))}
                                    {hasProducts ? (
                                      <Select.Group label="Products">
                                        {productPicks.map((choice) => (
                                          <Select.Item
                                            key={choice.key}
                                            value={choice.key}
                                            meta={choice.meta}
                                          >
                                            {choice.label}
                                          </Select.Item>
                                        ))}
                                      </Select.Group>
                                    ) : null}
                                    {current && !choices.some((c) => c.key === current) ? (
                                      // Paused or removed since this document was made.
                                      <Select.Item value={current}>
                                        {/* `||`: a service line keeps an empty name. */}
                                        {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
                                        {row?.name || "Unavailable item"}
                                      </Select.Item>
                                    ) : null}
                                  </Select>
                                )}
                              />
                            </Field>
                            <Field
                              id={`${kind}-item-${index}-qty`}
                              label="Qty"
                              error={rowErrors?.quantity?.message}
                            >
                              <Input
                                inputMode="numeric"
                                {...register(`items.${index}.quantity`)}
                              />
                            </Field>
                            <Field
                              id={`${kind}-item-${index}-price`}
                              label={`Price (${currency})`}
                              error={rowErrors?.unitPrice?.message}
                            >
                              <Input
                                inputMode="decimal"
                                {...register(`items.${index}.unitPrice`)}
                              />
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
                            {stockNote ? (
                              <p
                                role="status"
                                className="text-ink-2 col-span-full flex items-start gap-1.5 text-[13px] leading-snug font-semibold"
                              >
                                <Warning
                                  aria-hidden="true"
                                  weight="bold"
                                  className="mt-px size-4 shrink-0"
                                />
                                {stockNote}. You can still save the receipt.
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                      {errors.items?.message ? (
                        <p className="text-danger text-[13px]">
                          {errors.items.message}
                        </p>
                      ) : null}
                      <Button
                        variant="secondary"
                        size="sm"
                        className="justify-self-start"
                        onClick={() => {
                          const used = new Set((values.items ?? []).map((i) => rowKey(i)));
                          const next = choices.find((c) => !used.has(c.key)) ?? choices[0];
                          if (!next) return;
                          const isProduct = next.key.startsWith("product:");
                          const id = next.key.slice(next.key.indexOf(":") + 1);
                          items.append({
                            serviceId: isProduct ? "" : id,
                            ...(isProduct ? { productOptionId: id, name: next.label } : {}),
                            quantity: "1",
                            unitPrice: String(next.price),
                          });
                        }}
                      >
                        <Plus weight="bold" />
                        Add a line
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
                      <Field
                        id={`${kind}-amount`}
                        label={`Amount (${currency})`}
                        error={errors.amount?.message}
                      >
                        <Input
                          inputMode="decimal"
                          placeholder="15000"
                          {...register("amount")}
                        />
                      </Field>
                      <Field
                        id={`${kind}-description`}
                        label="Description (optional)"
                        error={errors.description?.message}
                      >
                        <Input
                          placeholder="Wig install and styling"
                          {...register("description")}
                        />
                      </Field>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field
                    id={`${kind}-tax`}
                    label="Tax (optional)"
                    error={errors.taxAmount?.message}
                  >
                    <Input
                      inputMode="decimal"
                      placeholder="0"
                      {...register("taxAmount")}
                    />
                  </Field>
                  <Field
                    id={`${kind}-discount`}
                    label="Discount (optional)"
                    error={errors.discount?.message}
                  >
                    <Input
                      inputMode="decimal"
                      placeholder="0"
                      {...register("discount")}
                    />
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
                        <Select
                          ref={field.ref}
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <Select.Item value="CASH">Cash</Select.Item>
                          <Select.Item value="BANK_TRANSFER">
                            Bank transfer
                          </Select.Item>
                        </Select>
                      )}
                    />
                  </Field>
                )}

                {isNewReceipt && sellsProducts ? (
                  <div className="grid grid-cols-1 gap-3">
                    <label className="flex cursor-pointer items-center gap-3 text-[15px]">
                      <input
                        type="checkbox"
                        className="accent-accent-ink size-5 cursor-pointer"
                        {...register("isDelivery")}
                      />
                      This is a delivery
                    </label>
                    {values.isDelivery ? (
                      <Field
                        id="receipt-delivery-address"
                        label="Delivery address"
                        error={errors.deliveryAddress?.message}
                      >
                        <Textarea
                          rows={2}
                          autoComplete="street-address"
                          placeholder="12 Adeola Odeku St, Victoria Island"
                          {...register("deliveryAddress")}
                        />
                      </Field>
                    ) : null}
                  </div>
                ) : null}

                {mode === "services" ? (
                  <Field
                    id={`${kind}-notes`}
                    label="Notes (optional)"
                    error={errors.description?.message}
                  >
                    <Textarea rows={2} {...register("description")} />
                  </Field>
                ) : null}

                <dl className="border-line grid gap-1 border-t pt-4 text-[15px]">
                  <Line
                    label="Subtotal"
                    value={formatMoney(totals.subtotal, currency)}
                  />
                  {totals.taxAmount > 0 ? (
                    <Line
                      label="Tax"
                      value={formatMoney(totals.taxAmount, currency)}
                      soft
                    />
                  ) : null}
                  {totals.discount > 0 ? (
                    <Line
                      label="Discount"
                      value={`− ${formatMoney(totals.discount, currency)}`}
                      soft
                    />
                  ) : null}
                  <Line
                    label="Total"
                    value={formatMoney(totals.total, currency)}
                    strong
                  />
                </dl>

                {error ? <Notice tone="danger">{error}</Notice> : null}

                <div className="grid gap-2.5 sm:flex sm:flex-row-reverse">
                  {editing ? (
                    kind === "invoice" &&
                    (editing as InvoiceDto).status === "DRAFT" ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={submit(true)}
                          isLoading={isPending}
                        >
                          Save changes
                        </Button>
                        <Button
                          type="button"
                          variant="primary"
                          onClick={submit(false)}
                          isLoading={isPending}
                        >
                          Save & send
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="submit"
                        variant="primary"
                        isLoading={isPending}
                      >
                        Save changes
                      </Button>
                    )
                  ) : (
                    <>
                      {kind === "invoice" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={submit(true)}
                          isLoading={isPending}
                        >
                          Save as draft
                        </Button>
                      ) : null}
                      <Button
                        type={kind === "invoice" ? "button" : "submit"}
                        variant="primary"
                        onClick={kind === "invoice" ? submit(false) : undefined}
                        isLoading={isPending}
                      >
                        {copy.submit}
                      </Button>
                    </>
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
        {kind === "invoice"
          ? "Send the link so they can see what they owe."
          : "Send the link as their proof of payment."}
      </Modal.Description>
      <div className="bg-surface mt-6 flex items-center gap-2 rounded-full py-1 pr-1 pl-4">
        <code className="text-ink min-w-0 flex-1 truncate font-mono text-[13px]">
          {created.shareUrl}
        </code>
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

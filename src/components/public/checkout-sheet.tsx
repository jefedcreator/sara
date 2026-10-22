"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { isAxiosError } from "axios";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import {
  checkoutFormSchema,
  type CheckoutFormSchema,
} from "@/backend/validators/order.validator";

import { optionLabel } from "@/utils/labels";
import {
  ArrowDisc,
  Button,
  Field,
  Input,
  Modal,
  Notice,
  Segmented,
  Textarea,
} from "@/primitives";
import { api } from "@/utils/api";
import { errorMessage } from "@/utils/axios";
import { formatMoney } from "@/utils/format";
import type { ProductOptionPage, ProductPage } from "@/utils/product-page";

type Fulfilment = "DELIVERY" | "PICKUP";

interface CheckoutSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: ProductPage;
  option: ProductOptionPage;
  quantity: number;
  /** A 409 told us fewer are left; lower the product page's cap too. */
  onCap: (optionId: string, max: number) => void;
  /** The product or option went away while the sheet was open. */
  onUnavailable: (message: string) => void;
}

/**
 * The customer's details, then off to Paystack. Built like the booking
 * details sheet: the line first, how it leaves the business, an address, the
 * customer, the money, and one payment action.
 */
export function CheckoutSheet({
  open,
  onOpenChange,
  page,
  option,
  quantity,
  onCap,
  onUnavailable,
}: CheckoutSheetProps) {
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const defaultFulfilment: Fulfilment = page.offersDelivery
    ? "DELIVERY"
    : "PICKUP";

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CheckoutFormSchema>({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: {
      fulfilment: defaultFulfilment,
      deliveryAddress: "",
      clientName: "",
      clientPhone: "",
      clientEmail: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      fulfilment: defaultFulfilment,
      deliveryAddress: "",
      clientName: "",
      clientPhone: "",
      clientEmail: "",
    });
    setRequestError(null);
    setIsPending(false);
  }, [defaultFulfilment, open, reset]);

  const fulfilment = watch("fulfilment");
  const unitPrice = Number(option.price);
  const subtotal = unitPrice * quantity;
  const deliveryFee =
    fulfilment === "DELIVERY" ? Number(page.deliveryFee ?? 0) : 0;
  const total = subtotal + deliveryFee;
  const money = (amount: number) => formatMoney(amount, page.currency);

  const fulfilmentOptions: { value: Fulfilment; label: string }[] = [];
  if (page.offersDelivery) {
    fulfilmentOptions.push({ value: "DELIVERY", label: "Delivery" });
  }
  if (page.offersPickup) {
    fulfilmentOptions.push({ value: "PICKUP", label: "Pickup" });
  }

  async function submit(values: CheckoutFormSchema) {
    setRequestError(null);
    setIsPending(true);

    try {
      const order = await api.public.order({
        productSlug: page.slug,
        optionId: option.id,
        quantity,
        fulfilment: values.fulfilment,
        deliveryAddress:
          values.fulfilment === "DELIVERY"
            ? values.deliveryAddress.trim()
            : null,
        clientName: values.clientName.trim(),
        clientPhone: values.clientPhone.trim(),
        clientEmail: values.clientEmail.trim() || null,
      });
      window.location.assign(order.paymentUrl);
    } catch (error) {
      setIsPending(false);
      const message = errorMessage(error);

      if (isAxiosError<{ message?: string }>(error) && error.response?.status === 409) {
        const left = /Only (\d+) left/i.exec(message);
        if (left) onCap(option.id, Number(left[1]));
        setRequestError(message);
        return;
      }

      if (message.startsWith("This product is no longer available")) {
        onUnavailable(message);
        onOpenChange(false);
        return;
      }

      setRequestError(message);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <Modal.Portal>
        <Modal.Content aria-describedby="checkout-line">
          <Modal.Handle />
          <Modal.Dismiss />
          <Modal.Title>Your details</Modal.Title>

          <div
            id="checkout-line"
            className="rounded-card bg-surface mt-4 px-4 py-3 text-[15px]"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold">
                {quantity} × {optionLabel(page.name, option.name)}
              </p>
              <p className="shrink-0 font-semibold tabular-nums">
                {money(subtotal)}
              </p>
            </div>
            <p className="text-muted mt-0.5">From {page.businessName}</p>
          </div>

          <form
            noValidate
            onSubmit={handleSubmit(submit)}
            className="mt-5 grid gap-4"
          >
            {fulfilmentOptions.length > 1 ? (
              <div className="grid grid-cols-1 gap-1.5">
                <p className="text-ink-2 text-sm leading-[1.3] font-semibold">
                  How you&apos;ll get it
                </p>
                <Segmented
                  label="How you'll get it"
                  value={fulfilment}
                  options={fulfilmentOptions}
                  onChange={(value) =>
                    setValue("fulfilment", value, { shouldValidate: true })
                  }
                />
              </div>
            ) : (
              <div className="rounded-card bg-surface flex items-baseline justify-between gap-3 px-4 py-3 text-[15px]">
                <span className="font-semibold">
                  {fulfilment === "DELIVERY" ? "Delivery" : "Pickup"}
                </span>
                <span className="text-muted text-right">
                  {fulfilment === "DELIVERY"
                    ? money(deliveryFee)
                    : (page.pickupAddress ?? page.businessName)}
                </span>
              </div>
            )}

            {fulfilment === "DELIVERY" ? (
              <Field
                id="deliveryAddress"
                label="Delivery address"
                error={errors.deliveryAddress?.message}
              >
                <Textarea
                  rows={2}
                  autoComplete="street-address"
                  {...register("deliveryAddress")}
                />
              </Field>
            ) : (
              <div className="rounded-card bg-surface px-4 py-3 text-[15px]">
                <p className="text-muted text-sm font-semibold">Pickup from</p>
                <p className="mt-0.5 text-pretty">
                  {page.pickupAddress ?? page.businessName}
                </p>
              </div>
            )}

            <Field
              id="clientName"
              label="Name"
              error={errors.clientName?.message}
            >
              <Input
                autoComplete="name"
                {...register("clientName")}
              />
            </Field>

            <Field
              id="clientPhone"
              label="Phone"
              hint={`So ${page.businessName} can reach you.`}
              error={errors.clientPhone?.message}
            >
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                {...register("clientPhone")}
              />
            </Field>

            <Field
              id="clientEmail"
              label="Email (optional)"
              hint="For your receipt."
              error={errors.clientEmail?.message}
            >
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                {...register("clientEmail")}
              />
            </Field>

            <dl className="border-line mt-1 grid gap-2 border-t pt-4 text-[15px]">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted">Items</dt>
                <dd className="tabular-nums">{money(subtotal)}</dd>
              </div>
              {fulfilment === "DELIVERY" ? (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted">Delivery fee</dt>
                  <dd className="tabular-nums">{money(deliveryFee)}</dd>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between gap-4 font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{money(total)}</dd>
              </div>
            </dl>

            {requestError ? <Notice tone="danger">{requestError}</Notice> : null}

            <Button
              type="submit"
              size="lg"
              isLoading={isPending}
              className="mt-1 w-full justify-between pr-2"
            >
              {isPending
                ? "Opening Paystack…"
                : `Pay ${money(total)} with Paystack`}
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

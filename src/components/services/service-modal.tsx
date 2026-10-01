"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ImageSquare } from "@phosphor-icons/react/dist/ssr";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { ServiceDto } from "types";

import {
  serviceFormSchema,
  type BookingModeValue,
  type ServiceFormInput,
  type ServiceFormOutput,
} from "@/backend/validators/service-form.validator";
import { Button, Field, Input, Modal, Notice, Segmented, Textarea, TimePicker } from "@/primitives";
import { formatDuration } from "@/utils/format";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface ServiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  service?: ServiceDto;
  currency: string;
  onSubmit: (values: ServiceFormOutput, image?: File) => void;
  isPending: boolean;
  error: string | null;
}

const MODE_OPTIONS = [
  { value: "SLOT", label: "By time slot" },
  { value: "NIGHTLY", label: "By the night" },
  { value: "DAILY", label: "By the day" },
] as const;

const COPY: Record<BookingModeValue, { name: string; price: string; description: string }> = {
  SLOT: { name: "Knotless braids", price: "Price", description: "What's included, what to bring, how to prepare." },
  NIGHTLY: { name: "Lekki 2-bed, Unit 4B", price: "Price per night", description: "Rooms, amenities, house rules, how check-in works." },
  DAILY: { name: "Toyota Prado, LND-482-KJ", price: "Price per day", description: "Seats, fuel policy, where to pick up, what to bring." },
};

function toFormValues(service?: ServiceDto): ServiceFormInput {
  const mode: BookingModeValue = service?.bookingMode ?? "SLOT";
  return {
    bookingMode: mode,
    name: service?.name ?? "",
    price: service ? String(Number(service.price)) : "",
    duration: service && mode === "SLOT" ? String(service.duration) : "",
    availableFrom: service?.availableFrom ?? "09:00",
    availableTo: service?.availableTo ?? "17:00",
    checkInTime: service?.checkInTime ?? "14:00",
    checkOutTime: service?.checkOutTime ?? "12:00",
    minUnits: String(service?.minUnits ?? 1),
    maxUnits: String(service && mode !== "SLOT" ? service.maxUnits : 30),
    description: service?.description ?? "",
  };
}

/** Create or edit a service. The parent remounts it (by key) per service. */
export function ServiceModal({
  open,
  onOpenChange,
  service,
  currency,
  onSubmit,
  isPending,
  error,
}: ServiceModalProps) {
  const isEdit = Boolean(service);
  const [image, setImage] = useState<File | undefined>();
  const [imageError, setImageError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(service?.image ?? null);

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ServiceFormInput, unknown, ServiceFormOutput>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: toFormValues(service),
  });

  // Object URLs for a picked photo are freed when replaced or unmounted.
  useEffect(() => {
    if (!image) return;
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const mode = watch("bookingMode");
  const copy = COPY[mode];
  const duration = Number(watch("duration"));
  const durationHint =
    Number.isInteger(duration) && duration > 0
      ? `That's ${formatDuration(duration)}.`
      : "In minutes, like 240 for 4 hours.";

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <Modal.Portal>
        <Modal.Content className="sm:max-w-[560px]">
          <Modal.Handle />
          <Modal.Dismiss />
          <Modal.Title>{isEdit ? "Edit service" : "Add a service"}</Modal.Title>
          <Modal.Description>
            {isEdit
              ? "Changes show on this service's booking link straight away."
              : "Each service gets its own booking link. Customers pick a time, dates or days there and pay."}
          </Modal.Description>

          <form
            noValidate
            autoComplete="off"
            onSubmit={handleSubmit((values) => onSubmit(values, image))}
            className="mt-6 grid gap-4"
          >
            <div className="grid gap-2">
              <p className="text-ink-2 text-sm font-semibold">How do customers book this?</p>
              <Controller
                control={control}
                name="bookingMode"
                render={({ field }) => (
                  <Segmented
                    label="How do customers book this?"
                    value={field.value}
                    options={MODE_OPTIONS}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>

            <Field
              id="service-name"
              label="Name"
              hint={isEdit ? "Renaming gives the service a new booking link; the old one stops working." : undefined}
              error={errors.name?.message}
            >
              <Input placeholder={copy.name} {...register("name")} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field id="service-price" label={`${copy.price} (${currency})`} error={errors.price?.message}>
                <Input inputMode="decimal" placeholder={mode === "SLOT" ? "25000" : mode === "NIGHTLY" ? "85000" : "70000"} {...register("price")} />
              </Field>
              {mode === "SLOT" ? (
                <Field id="service-duration" label="Duration (min)" hint={errors.duration ? undefined : durationHint} error={errors.duration?.message}>
                  <Input inputMode="numeric" placeholder="240" {...register("duration")} />
                </Field>
              ) : (
                <div aria-hidden="true" />
              )}
            </div>

            {mode === "NIGHTLY" ? (
              <div className="grid grid-cols-2 gap-4">
                <Field id="service-check-in" label="Check-in from" error={errors.checkInTime?.message}>
                  <Controller control={control} name="checkInTime" render={({ field }) => (
                    <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} />
                  )} />
                </Field>
                <Field id="service-check-out" label="Check-out by" error={errors.checkOutTime?.message}>
                  <Controller control={control} name="checkOutTime" render={({ field }) => (
                    <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} />
                  )} />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Field id="service-from" label={mode === "DAILY" ? "Pickups from" : "Bookable from"} error={errors.availableFrom?.message}>
                  <Controller control={control} name="availableFrom" render={({ field }) => (
                    <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} />
                  )} />
                </Field>
                <Field id="service-to" label="Until" error={errors.availableTo?.message}>
                  <Controller control={control} name="availableTo" render={({ field }) => (
                    <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} />
                  )} />
                </Field>
              </div>
            )}

            {mode !== "SLOT" ? (
              <div className="grid grid-cols-2 gap-4">
                <Field id="service-min" label={`Minimum ${mode === "NIGHTLY" ? "nights" : "days"}`} error={errors.minUnits?.message}>
                  <Input inputMode="numeric" placeholder="1" {...register("minUnits")} />
                </Field>
                <Field id="service-max" label={`Maximum ${mode === "NIGHTLY" ? "nights" : "days"}`} error={errors.maxUnits?.message}>
                  <Input inputMode="numeric" placeholder="30" {...register("maxUnits")} />
                </Field>
              </div>
            ) : null}

            <Field id="service-description" label="Description (optional)" error={errors.description?.message}>
              <Textarea
                rows={3}
                placeholder={copy.description}
                {...register("description")}
              />
            </Field>

            <Field
              id="service-image"
              label="Photo (optional)"
              hint="JPG or PNG, up to 5 MB."
              error={imageError ?? undefined}
            >
              <label
                htmlFor="service-image"
                className="rounded-card border-line hover:border-ink-2 flex cursor-pointer items-center gap-4 border border-dashed p-3 transition-colors duration-200"
              >
                <span className="bg-surface rounded-chip grid size-16 shrink-0 place-items-center overflow-hidden">
                  {preview ? (
                    // A local blob or a Cloudinary URL; next/image adds nothing here.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" className="size-full object-cover" />
                  ) : (
                    <ImageSquare className="text-faint size-6" />
                  )}
                </span>
                <span className="text-ink-2 text-[15px] font-semibold">
                  {preview ? "Change photo" : "Choose a photo"}
                </span>
                <input
                  id="service-image"
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (file.size > MAX_IMAGE_BYTES) {
                      setImageError("That photo is over 5 MB. Pick a smaller one.");
                      return;
                    }
                    setImageError(null);
                    setImage(file);
                  }}
                />
              </label>
            </Field>

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <div className="mt-2 grid gap-2.5 sm:flex sm:flex-row-reverse">
              <Button type="submit" isLoading={isPending}>
                {isEdit ? "Save changes" : "Add service"}
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

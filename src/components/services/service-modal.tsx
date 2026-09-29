"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ImageSquare } from "@phosphor-icons/react/dist/ssr";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { ServiceDto } from "types";

import {
  serviceFormSchema,
  type ServiceFormInput,
  type ServiceFormOutput,
} from "@/backend/validators/service-form.validator";
import { Button, Field, Input, Modal, Notice, Textarea, TimePicker } from "@/primitives";
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

function toFormValues(service?: ServiceDto): ServiceFormInput {
  return {
    name: service?.name ?? "",
    price: service ? String(Number(service.price)) : "",
    duration: service ? String(service.duration) : "",
    availableFrom: service?.availableFrom ?? "09:00",
    availableTo: service?.availableTo ?? "17:00",
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
              : "Each service gets its own booking link that customers use to pick a time and pay."}
          </Modal.Description>

          <form
            noValidate
            autoComplete="off"
            onSubmit={handleSubmit((values) => onSubmit(values, image))}
            className="mt-6 grid gap-4"
          >
            <Field
              id="service-name"
              label="Name"
              hint={isEdit ? "Renaming gives the service a new booking link; the old one stops working." : undefined}
              error={errors.name?.message}
            >
              <Input placeholder="Knotless braids" {...register("name")} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field id="service-price" label={`Price (${currency})`} error={errors.price?.message}>
                <Input inputMode="decimal" placeholder="25000" {...register("price")} />
              </Field>
              <Field
                id="service-duration"
                label="Duration (min)"
                hint={errors.duration ? undefined : durationHint}
                error={errors.duration?.message}
              >
                <Input inputMode="numeric" placeholder="240" {...register("duration")} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field id="service-from" label="Bookable from" error={errors.availableFrom?.message}>
                <Controller
                  control={control}
                  name="availableFrom"
                  render={({ field }) => (
                    <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} />
                  )}
                />
              </Field>
              <Field id="service-to" label="Until" error={errors.availableTo?.message}>
                <Controller
                  control={control}
                  name="availableTo"
                  render={({ field }) => (
                    <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} />
                  )}
                />
              </Field>
            </div>

            <Field id="service-description" label="Description (optional)" error={errors.description?.message}>
              <Textarea
                rows={3}
                placeholder="What's included, what to bring, how to prepare."
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

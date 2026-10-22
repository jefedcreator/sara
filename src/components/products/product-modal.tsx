"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "@phosphor-icons/react/dist/ssr";
import { useCallback, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { ProductDto } from "types";

import {
  productFormSchema,
  type ProductFormInput,
  type ProductFormOutput,
} from "@/backend/validators/product-form.validator";
import {
  Button,
  Field,
  Input,
  Modal,
  Notice,
  Switch,
  Textarea,
} from "@/primitives";

import { OptionsEditor } from "./options-editor";

const MAX_PHOTOS = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type PhotoEntry = {
  key: string;
  url: string;
  /** Present for a newly chosen file; saved photos have only their URL. */
  file?: File;
};

interface ProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  product?: ProductDto;
  currency: string;
  onSubmit: (
    values: ProductFormOutput,
    photos: File[],
    keepPhotos: string[],
  ) => void;
  isPending: boolean;
  error: string | null;
}

function toFormValues(product?: ProductDto): ProductFormInput {
  return {
    name: product?.name ?? "",
    price: product ? String(Number(product.price)) : "",
    description: product?.description ?? "",
    tracksStock: product?.tracksStock ?? true,
    options:
      product && product.options.length > 0
        ? product.options.map((option) => ({
            id: option.id,
            name: option.name,
            price: option.price == null ? "" : String(Number(option.price)),
            stock: String(option.stock),
          }))
        : [{ name: "", price: "", stock: "" }],
  };
}

function toPhotoEntries(product?: ProductDto): PhotoEntry[] {
  return (product?.photos ?? []).map((url, index) => ({
    key: `saved-${index}`,
    url,
  }));
}

/** Create or edit a product. The parent remounts it (by key) per product. */
export function ProductModal({
  open,
  onOpenChange,
  product,
  currency,
  onSubmit,
  isPending,
  error,
}: ProductModalProps) {
  const isEdit = Boolean(product);
  const [photos, setPhotos] = useState<PhotoEntry[]>(() =>
    toPhotoEntries(product),
  );
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const objectUrls = useRef<string[]>([]);
  const photoKey = useRef(0);

  const releaseObjectUrls = useCallback(() => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current = [];
  }, []);

  // The hidden node unmounts with the modal (or the next keyed opening), so
  // local previews never outlive the sheet.
  const cleanupRef = useCallback(
    (node: HTMLSpanElement | null) => {
      if (!node) releaseObjectUrls();
    },
    [releaseObjectUrls],
  );

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ProductFormInput, unknown, ProductFormOutput>({
    resolver: zodResolver(productFormSchema),
    defaultValues: toFormValues(product),
  });

  const tracksStock = watch("tracksStock");

  function addPhotos(files: FileList | null) {
    const chosen = Array.from(files ?? []);
    if (chosen.length === 0) return;

    const room = MAX_PHOTOS - photos.length;
    const smallEnough = chosen.filter((file) => file.size <= MAX_IMAGE_BYTES);
    const accepted = smallEnough.slice(0, Math.max(room, 0));

    setPhotoError(
      smallEnough.length < chosen.length
        ? "That photo is over 5 MB. Pick a smaller one."
        : null,
    );
    setPhotoNotice(
      chosen.length > room ? "A product can have up to 5 photos." : null,
    );

    const added = accepted.map((file) => {
      const url = URL.createObjectURL(file);
      objectUrls.current.push(url);
      photoKey.current += 1;
      return { key: `new-${photoKey.current}`, url, file };
    });

    setPhotos((current) => [...current, ...added]);
  }

  function removePhoto(key: string) {
    const target = photos.find((photo) => photo.key === key);
    if (target?.file) {
      URL.revokeObjectURL(target.url);
      objectUrls.current = objectUrls.current.filter((url) => url !== target.url);
    }
    setPhotos((current) => current.filter((photo) => photo.key !== key));
    setPhotoError(null);
    setPhotoNotice(null);
  }

  function makeCover(index: number) {
    setPhotos((current) => {
      const next = [...current];
      const [picked] = next.splice(index, 1);
      return picked ? [picked, ...next] : current;
    });
  }

  return (
    <>
      <span ref={cleanupRef} hidden aria-hidden="true" />
      <Modal open={open} onOpenChange={onOpenChange}>
        <Modal.Portal>
          <Modal.Content className="sm:max-w-[560px]">
            <Modal.Handle />
            <Modal.Dismiss />
            <Modal.Title>{isEdit ? "Edit product" : "Add a product"}</Modal.Title>
            <Modal.Description>
              {isEdit
                ? "Changes show on this product's link straight away."
                : "Each product gets its own link. Customers pick an option there and pay."}
            </Modal.Description>

            <form
              noValidate
              autoComplete="off"
              onSubmit={handleSubmit((values) => {
                const newPhotos = photos.flatMap((photo) =>
                  photo.file ? [photo.file] : [],
                );
                const keepPhotos = photos.flatMap((photo) =>
                  photo.file ? [] : [photo.url],
                );
                onSubmit(values, newPhotos, keepPhotos);
              })}
              className="mt-6 grid gap-5"
            >
              <Field
                id="product-photos"
                label="Photos"
                hint={
                  photoNotice ??
                  (photos.length >= MAX_PHOTOS
                    ? "That's 5 photos, the most a product can have. Remove one to add another."
                    : "Up to 5 photos. The first is the cover on your link card.")
                }
                error={photoError ?? undefined}
              >
                <ul className="grid gap-2">
                  {photos.map((photo, index) => (
                    <li
                      key={photo.key}
                      className="border-line bg-canvas flex items-center gap-3 rounded-card border p-2"
                    >
                      {/* A local blob or a Cloudinary URL; next/image adds nothing here. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt=""
                        className="rounded-chip bg-surface size-14 shrink-0 object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        {index === 0 ? (
                          <span className="bg-accent-soft text-accent-ink inline-flex rounded-full px-2.5 py-1 text-sm font-semibold">
                            Cover
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => makeCover(index)}
                            className="text-ink-2 hover:text-ink cursor-pointer rounded-full px-1 py-1 text-sm font-semibold transition-colors duration-150"
                          >
                            Make cover
                          </button>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove photo ${index + 1}`}
                        onClick={() => removePhoto(photo.key)}
                      >
                        <X weight="bold" />
                      </Button>
                    </li>
                  ))}
                </ul>

                {photos.length < MAX_PHOTOS ? (
                  <label
                    htmlFor="product-photos"
                    className="rounded-card border-line hover:border-ink-2 mt-2 flex min-h-14 cursor-pointer items-center gap-3 border border-dashed px-3 py-2.5 transition-colors duration-200"
                  >
                    <span className="bg-surface text-ink-2 rounded-chip grid size-8 shrink-0 place-items-center">
                      <Plus className="size-4" weight="bold" />
                    </span>
                    <span className="text-ink-2 text-base font-semibold">
                      {photos.length === 0 ? "Choose photos" : "Add another photo"}
                    </span>
                  </label>
                ) : null}

                <input
                  id="product-photos"
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={photos.length >= MAX_PHOTOS}
                  className="sr-only"
                  onChange={(event) => {
                    addPhotos(event.target.files);
                    event.target.value = "";
                  }}
                />
              </Field>

              <Field
                id="product-name"
                label="Name"
                error={errors.name?.message}
              >
                <Input placeholder="Frontal wig" {...register("name")} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="product-price"
                  label={`Price (${currency})`}
                  error={errors.price?.message}
                >
                  <Input
                    inputMode="decimal"
                    placeholder="45000"
                    {...register("price")}
                  />
                </Field>
              </div>

              <Field
                id="product-description"
                label="Description (optional)"
                error={errors.description?.message}
              >
                <Textarea
                  rows={3}
                  placeholder="What it's made of, how long it is, anything a buyer should know."
                  {...register("description")}
                />
              </Field>

              <OptionsEditor
                control={control}
                register={register}
                errors={errors}
                tracksStock={tracksStock}
                currency={currency}
              />

              <div className="border-line flex items-start justify-between gap-4 rounded-card border p-4">
                <label htmlFor="product-track-stock" className="cursor-pointer">
                  <span className="text-ink-2 block text-sm font-semibold">
                    Track stock
                  </span>
                  <span className="text-muted mt-1 block text-sm leading-snug text-pretty">
                    Off means made to order. Customers can still order; you just
                    won&apos;t see stock counts.
                  </span>
                </label>
                <Controller
                  control={control}
                  name="tracksStock"
                  render={({ field }) => (
                    <Switch
                      id="product-track-stock"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>

              {error ? <Notice tone="danger">{error}</Notice> : null}

              <div className="mt-1 grid gap-2.5 sm:flex sm:flex-row-reverse">
                <Button type="submit" isLoading={isPending}>
                  {isEdit ? "Save changes" : "Add product"}
                </Button>
                <Modal.Close asChild>
                  <Button variant="secondary">Cancel</Button>
                </Modal.Close>
              </div>
            </form>
          </Modal.Content>
        </Modal.Portal>
      </Modal>
    </>
  );
}

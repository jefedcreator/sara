"use client";

import { Plus, X } from "@phosphor-icons/react/dist/ssr";
import {
  useFieldArray,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from "react-hook-form";

import type { ProductFormInput } from "@/backend/validators/product-form.validator";
import { Button, Field, Input } from "@/primitives";

const MAX_OPTIONS = 20;

interface OptionsEditorProps {
  control: Control<ProductFormInput>;
  register: UseFormRegister<ProductFormInput>;
  errors: FieldErrors<ProductFormInput>;
  tracksStock: boolean;
  currency: string;
}

/**
 * The options a product is sold in: sizes, lengths, colours. A product with
 * no options uses one unnamed row, which the service stores as its default
 * option. Stock fields disappear when the product is made to order.
 */
export function OptionsEditor({
  control,
  register,
  errors,
  tracksStock,
  currency,
}: OptionsEditorProps) {
  // `keyName` keeps React Hook Form's row key away from the option's real id.
  const { fields, append, remove } = useFieldArray({
    control,
    name: "options",
    keyName: "_key",
  });

  return (
    <div className="grid gap-3">
      <div>
        <p className="text-ink-2 text-sm font-semibold">
          Sizes, lengths or colours?
        </p>
        <p className="text-muted mt-1 text-sm leading-snug text-pretty">
          Add each version a customer can choose. Leave the name empty when
          there&apos;s only one.
        </p>
      </div>

      <div className="grid gap-2.5">
        {fields.map((field, index) => {
          const rowErrors = errors.options?.[index];
          const onlyOption = fields.length === 1;

          return (
            <div
              key={field._key}
              className="rounded-card bg-surface grid gap-3 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-ink-2 text-sm font-semibold">
                  Option {index + 1}
                </p>
                {onlyOption ? null : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove option ${index + 1}`}
                    onClick={() => remove(index)}
                  >
                    <X weight="bold" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field
                  id={`product-option-${index}-name`}
                  label={onlyOption ? "Name (optional)" : "Name"}
                  hint={
                    onlyOption
                      ? "Leave it empty when this is the only option."
                      : undefined
                  }
                  error={rowErrors?.name?.message}
                  className="col-span-2"
                >
                  <Input
                    placeholder="20 inch"
                    {...register(`options.${index}.name`)}
                  />
                </Field>

                <Field
                  id={`product-option-${index}-price`}
                  label={`Price (${currency})`}
                  error={rowErrors?.price?.message}
                  className={tracksStock ? undefined : "col-span-2"}
                >
                  <Input
                    inputMode="decimal"
                    placeholder="Same price"
                    {...register(`options.${index}.price`)}
                  />
                </Field>

                {tracksStock ? (
                  <Field
                    id={`product-option-${index}-stock`}
                    label="Stock"
                    error={rowErrors?.stock?.message}
                  >
                    <Input
                      inputMode="numeric"
                      placeholder="0"
                      {...register(`options.${index}.stock`)}
                    />
                  </Field>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={fields.length >= MAX_OPTIONS}
          onClick={() => append({ name: "", price: "", stock: "" })}
        >
          <Plus weight="bold" />
          Add an option
        </Button>
        {fields.length >= MAX_OPTIONS ? (
          <p className="text-muted text-sm">
            A product can have up to {MAX_OPTIONS} options.
          </p>
        ) : null}
      </div>
    </div>
  );
}

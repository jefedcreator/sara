"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { BusinessProfileDto } from "types";

import {
  businessProfileFormSchema,
  type BusinessProfileFormSchema,
} from "@/backend/validators/business.validator";
import { Button, Field, Input, Notice, Textarea } from "@/primitives";

import { Section } from "./section";

interface ProfileSectionProps {
  profile: BusinessProfileDto;
  onSave: (values: BusinessProfileFormSchema) => void;
  isPending: boolean;
  error: string | null;
  saved: boolean;
}

export function ProfileSection({ profile, onSave, isPending, error, saved }: ProfileSectionProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<BusinessProfileFormSchema>({
    resolver: zodResolver(businessProfileFormSchema),
    // `values` re-syncs the form when the saved profile comes back.
    values: {
      name: profile.name,
      phone: profile.phone ?? "",
      email: profile.email ?? "",
      address: profile.address ?? "",
      city: profile.city ?? "",
      state: profile.state ?? "",
      description: profile.description ?? "",
    },
  });

  return (
    <Section
      id="profile-h"
      title="Business"
      description="Customers see your name on booking links, invoices and receipts."
    >
      <form noValidate autoComplete="off" onSubmit={handleSubmit(onSave)} className="grid gap-4">
        <Field id="profile-name" label="Business name" error={errors.name?.message}>
          <Input {...register("name")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="profile-phone" label="Phone" error={errors.phone?.message}>
            <Input type="tel" inputMode="tel" {...register("phone")} />
          </Field>
          <Field id="profile-email" label="Email" error={errors.email?.message}>
            <Input type="email" inputMode="email" {...register("email")} />
          </Field>
        </div>
        <Field id="profile-address" label="Address" error={errors.address?.message}>
          <Input {...register("address")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="profile-city" label="City" error={errors.city?.message}>
            <Input {...register("city")} />
          </Field>
          <Field id="profile-state" label="State" error={errors.state?.message}>
            <Input {...register("state")} />
          </Field>
        </div>
        <Field id="profile-description" label="About" error={errors.description?.message}>
          <Textarea rows={3} {...register("description")} />
        </Field>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        <div className="flex items-center gap-4">
          <Button type="submit" variant="dark" isLoading={isPending} disabled={!isDirty}>
            Save business
          </Button>
          {saved && !isDirty ? (
            <p className="text-accent-ink text-sm font-semibold" role="status">
              Saved
            </p>
          ) : null}
        </div>
      </form>
    </Section>
  );
}

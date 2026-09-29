"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { isAxiosError } from "axios";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  businessSetupFormSchema,
  type BusinessSetupFormSchema,
} from "@/backend/validators/business.validator";
import { SetupShell } from "@/components/setup-shell";
import { useCreateBusinessMutation } from "@/hooks/mutations/use-business-mutations";
import { ArrowDisc, Button, Field, Input, Notice } from "@/primitives";
import { useMonoConnect } from "@/utils/hooks/useMonoConnect";

interface OnboardingClientProps {
  next: string;
  defaultEmail: string;
  monoPublicKey: string;
}

/** Drops the "" an empty optional input leaves behind. */
function compact(values: BusinessSetupFormSchema) {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== ""),
  ) as Partial<BusinessSetupFormSchema> & { name: string };
}

/**
 * First run: the business's details, then Mono to link the bank account
 * payments settle into. The business is created the moment Mono hands back
 * its code, since the API needs both together.
 */
export function OnboardingClient({ next, defaultEmail, monoPublicKey }: OnboardingClientProps) {
  const router = useRouter();
  const [details, setDetails] = useState<BusinessSetupFormSchema | null>(null);
  const create = useCreateBusinessMutation();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<BusinessSetupFormSchema>({
    resolver: zodResolver(businessSetupFormSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: defaultEmail,
      address: "",
      city: "",
      state: "",
    },
  });

  const mono = useMonoConnect({
    publicKey: monoPublicKey,
    onSuccess: ({ code }) => {
      if (!details) return;
      create.mutate(
        {
          ...compact(details),
          monoCode: code,
          // Sara settles through Paystack in naira.
          currency: "NGN",
          country: "Nigeria",
        },
        {
          onSuccess: () => {
            router.replace(next);
            router.refresh();
          },
          onError: (error) => {
            if (isAxiosError(error) && error.response?.status === 409) {
              setDetails(null);
              setError("name", {
                message:
                  "That name is already on Sara. Add your area, like “Tobi Beauty Yaba”.",
              });
            }
          },
        },
      );
    },
  });

  if (!details) {
    return (
      <SetupShell
        step={1}
        title="Tell us about your business."
        body="Customers see your business name on your booking links and invoices. You can change any of this later."
      >
        <form
          noValidate
          autoComplete="off"
          onSubmit={handleSubmit((values) => {
            create.reset();
            setDetails(values);
          })}
          className="grid gap-4"
        >
          <Field id="name" label="Business name" error={errors.name?.message}>
            <Input autoComplete="organization" {...register("name")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="phone" label="Phone (optional)" error={errors.phone?.message}>
              <Input type="tel" inputMode="tel" {...register("phone")} />
            </Field>
            <Field id="email" label="Email (optional)" error={errors.email?.message}>
              <Input type="email" inputMode="email" {...register("email")} />
            </Field>
          </div>
          <Field
            id="address"
            label="Address (optional)"
            hint="Used to work out distance for home-service bookings."
            error={errors.address?.message}
          >
            <Input {...register("address")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="city" label="City (optional)" error={errors.city?.message}>
              <Input {...register("city")} />
            </Field>
            <Field id="state" label="State (optional)" error={errors.state?.message}>
              <Input {...register("state")} />
            </Field>
          </div>
          <Button type="submit" size="lg" className="mt-2 w-full justify-between pr-2 sm:w-auto">
            Continue to bank linking
            <ArrowDisc />
          </Button>
        </form>
      </SetupShell>
    );
  }

  const isWorking = create.isPending || create.isSuccess;

  return (
    <SetupShell
      step={1}
      title="Link the account you get paid into."
      body="Customers pay through Paystack and the money settles straight into this account. Mono connects it securely; Sara never sees your banking password."
    >
      <div className="rounded-panel bg-surface px-5 py-5">
        <p className="text-muted text-[13px]">Setting up</p>
        <p className="font-display mt-0.5 text-[19px] leading-[1.2] font-medium tracking-[-0.02em]">
          {details.name}
        </p>
        <button
          type="button"
          onClick={() => setDetails(null)}
          disabled={isWorking}
          className="text-ink-2 hover:text-ink mt-2 cursor-pointer text-sm font-semibold underline decoration-accent-tint underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Edit details
        </button>
      </div>

      {!monoPublicKey ? (
        <Notice tone="danger" className="mt-5">
          Bank linking isn&apos;t configured yet (NEXT_PUBLIC_MONO_PUBLIC_KEY is
          missing).
        </Notice>
      ) : mono.error ? (
        <Notice tone="danger" className="mt-5">
          Mono didn&apos;t load. Check your connection and refresh the page.
        </Notice>
      ) : create.isError ? (
        <Notice tone="danger" className="mt-5">
          We couldn&apos;t link that account. Try again, or use a different
          account.
        </Notice>
      ) : null}

      <Button
        size="lg"
        className="mt-6 w-full sm:w-auto"
        onClick={mono.open}
        disabled={!monoPublicKey || mono.isLoading || Boolean(mono.error)}
        isLoading={isWorking}
      >
        {isWorking ? "Setting up your business…" : "Link bank account"}
      </Button>
    </SetupShell>
  );
}

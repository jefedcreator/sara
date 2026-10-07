"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BusinessClosureDto, BusinessHoursDto, BusinessProfileDto } from "types";

import type { BusinessProfileFormSchema } from "@/backend/validators/business.validator";
import {
  useAddClosureMutation,
  useConnectCalendarMutation,
  useDisconnectCalendarMutation,
  useRemoveClosureMutation,
  useSaveHoursMutation,
  useUpdateBusinessMutation,
} from "@/hooks/mutations/use-business-mutations";
import { useBusinessHoursQuery, useClosuresQuery } from "@/hooks/queries/use-business";
import { StatusPill } from "@/primitives";
import { errorMessage } from "@/utils/axios";

import { CalendarSection } from "./calendar-section";
import { ClosuresSection } from "./closures-section";
import { HoursSection } from "./hours-section";
import { ProfileSection } from "./profile-section";
import { Section } from "./section";

interface SettingsPageClientProps {
  profile: BusinessProfileDto;
  initialHours: BusinessHoursDto[];
  initialClosures: BusinessClosureDto[];
  calendarReturn: "connected" | "failed" | null;
}

/** Owns every settings query and mutation; the sections are pure UI. */
export function SettingsPageClient({
  profile,
  initialHours,
  initialClosures,
  calendarReturn,
}: SettingsPageClientProps) {
  const router = useRouter();
  const { data: hours = initialHours } = useBusinessHoursQuery(initialHours);
  const { data: closures = initialClosures } = useClosuresQuery(initialClosures);

  const updateBusiness = useUpdateBusinessMutation();
  const saveHours = useSaveHoursMutation();
  const addClosure = useAddClosureMutation();
  const removeClosure = useRemoveClosureMutation();
  const connectCalendar = useConnectCalendarMutation();
  const disconnectCalendar = useDisconnectCalendarMutation();
  const [removingId, setRemovingId] = useState<string | null>(null);

  function saveProfile(values: BusinessProfileFormSchema) {
    // An emptied email can't be sent (the API wants a valid one), so it is
    // left as it was; other emptied fields are cleared.
    const { email, ...rest } = values;
    updateBusiness.mutate(email ? { ...rest, email } : rest, {
      // The profile (and the business name in the top bar) are server data.
      onSuccess: () => router.refresh(),
    });
  }

  return (
    <div className="grid grid-cols-1 gap-8">
      <header>
        <h1 className="font-display text-[clamp(1.9rem,1.3rem+2.2vw,3rem)] leading-[1.06] font-normal tracking-[-0.035em]">
          Settings
        </h1>
        <p className="text-muted mt-2 max-w-[52ch] text-pretty">
          Your business details and when customers can book you.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 min-[1040px]:grid-cols-2 min-[1040px]:items-start">
        <div className="grid grid-cols-1 gap-4">
          <ProfileSection
            profile={profile}
            onSave={saveProfile}
            isPending={updateBusiness.isPending}
            error={updateBusiness.isError ? errorMessage(updateBusiness.error) : null}
            saved={updateBusiness.isSuccess}
          />
          <Section
            id="payouts-h"
            title="Payouts"
            description="Customers pay through Paystack; the money settles into your linked bank account."
          >
            {profile.isPaymentReady ? (
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill>Linked</StatusPill>
                {profile.settlementAccountName ? (
                  <p className="text-ink-2 text-[15px] font-semibold">
                    {profile.settlementAccountName}
                  </p>
                ) : null}
              </div>
            ) : (
              <StatusPill tone="danger">Not linked</StatusPill>
            )}
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <HoursSection
            hours={hours}
            onSave={(days, onSaved) => saveHours.mutate(days, { onSuccess: onSaved })}
            isPending={saveHours.isPending}
            error={saveHours.isError ? errorMessage(saveHours.error) : null}
            saved={saveHours.isSuccess}
          />
          <ClosuresSection
            closures={closures}
            onAdd={(values, onAdded) => {
              addClosure.reset();
              addClosure.mutate(
                { date: values.date, reason: values.reason || undefined },
                { onSuccess: onAdded },
              );
            }}
            isAdding={addClosure.isPending}
            addError={addClosure.isError ? errorMessage(addClosure.error) : null}
            onRemove={(id) => {
              setRemovingId(id);
              removeClosure.mutate(id, { onSettled: () => setRemovingId(null) });
            }}
            removingId={removingId}
          />
          <CalendarSection
            connectedAt={profile.calendarConnectedAt}
            returnedWith={calendarReturn}
            onConnect={() => connectCalendar.mutate()}
            isConnecting={connectCalendar.isPending || connectCalendar.isSuccess}
            onDisconnect={(onDone) =>
              disconnectCalendar.mutate(undefined, {
                onSuccess: () => {
                  onDone();
                  router.refresh();
                },
              })
            }
            isDisconnecting={disconnectCalendar.isPending}
            error={
              connectCalendar.isError
                ? errorMessage(connectCalendar.error)
                : disconnectCalendar.isError
                  ? errorMessage(disconnectCalendar.error)
                  : null
            }
          />
        </div>
      </div>
    </div>
  );
}

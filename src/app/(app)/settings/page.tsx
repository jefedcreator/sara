import { type Metadata } from "next";

import { AppError } from "@/components/app-error";
import { SettingsPageClient } from "@/components/settings/settings-page-client";
import { getBusinessHours, getClosures, requireBusiness, toBusinessProfile } from "@/server";

export const metadata: Metadata = {
  title: "Settings · Sara",
  robots: { index: false },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { business } = await requireBusiness("/settings");
  const { calendar } = await searchParams;

  let hours, closures;
  try {
    [hours, closures] = await Promise.all([
      getBusinessHours(business.id),
      getClosures(business.id),
    ]);
  } catch (error) {
    console.error("[settings] failed to load:", error);
    return <AppError title="Your settings didn't load." />;
  }

  return (
    <SettingsPageClient
      profile={toBusinessProfile(business)}
      initialHours={hours}
      initialClosures={closures}
      calendarReturn={calendar === "connected" || calendar === "failed" ? calendar : null}
    />
  );
}

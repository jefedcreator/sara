import { type Metadata } from "next";
import { redirect } from "next/navigation";

import { OnboardingClient } from "@/components/onboarding/onboarding-client";
import { env } from "@/env";
import { requireUser } from "@/server";
import { safeNextPath } from "@/utils/redirect";

export const metadata: Metadata = {
  title: "Set up your business · Sara",
  robots: { index: false },
};


export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const user = await requireUser(`/onboarding?next=${encodeURIComponent(next)}`);

  if (user.business) redirect(next);

  return (
    <OnboardingClient
      next={next}
      defaultEmail={user.email ?? ""}
      monoPublicKey={env.NEXT_PUBLIC_MONO_PUBLIC_KEY ?? ""}
    />
  );
}

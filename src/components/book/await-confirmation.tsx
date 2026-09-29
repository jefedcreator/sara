"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Spinner } from "@/primitives";

const INTERVAL_MS = 3000;
const MAX_TRIES = 20;

/**
 * Re-renders the page every few seconds until Paystack's webhook confirms the
 * booking (the server then renders the confirmed state instead of this).
 */
export function AwaitConfirmation() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  const gaveUp = tries >= MAX_TRIES;

  useEffect(() => {
    if (gaveUp) return;
    const timer = setTimeout(() => {
      router.refresh();
      setTries((n) => n + 1);
    }, INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [tries, gaveUp, router]);

  if (gaveUp) {
    return (
      <p className="text-muted max-w-[46ch] text-[15px]" role="status">
        Paystack hasn&apos;t confirmed yet. If you paid, your confirmation email
        will arrive shortly; there&apos;s no need to pay again.
      </p>
    );
  }

  return (
    <p className="text-accent-ink flex items-center gap-2.5 text-[15px] font-semibold" role="status">
      <Spinner />
      Checking with Paystack
    </p>
  );
}

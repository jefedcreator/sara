"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { Spinner } from "@/primitives";

const INTERVAL_MS = 3000;
const MAX_TRIES = 20;

/**
 * Re-renders the page every few seconds until Paystack's webhook confirms the
 * booking (the server then renders the confirmed state instead of this).
 */
export function AwaitConfirmation() {
  const router = useRouter();
  const routerRef = useRef(router);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triesRef = useRef(0);
  const [gaveUp, setGaveUp] = useState(false);
  routerRef.current = router;

  const stopPolling = useCallback(() => {
    if (!timerRef.current) return;
    clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const pollerRef = useCallback(
    (node: HTMLParagraphElement | null) => {
      if (!node) {
        stopPolling();
        return;
      }
      if (timerRef.current) return;

      timerRef.current = setInterval(() => {
        triesRef.current += 1;
        routerRef.current.refresh();

        if (triesRef.current >= MAX_TRIES) {
          stopPolling();
          setGaveUp(true);
        }
      }, INTERVAL_MS);
    },
    [stopPolling],
  );

  if (gaveUp) {
    return (
      <p className="text-muted max-w-[46ch] text-[15px]" role="status">
        Paystack hasn&apos;t confirmed yet. If you paid, your confirmation email
        will arrive shortly; there&apos;s no need to pay again.
      </p>
    );
  }

  return (
    <p
      ref={pollerRef}
      className="text-accent-ink flex items-center gap-2.5 text-[15px] font-semibold"
      role="status"
    >
      <Spinner />
      Checking with Paystack
    </p>
  );
}

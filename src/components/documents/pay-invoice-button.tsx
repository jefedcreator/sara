"use client";

import { useState } from "react";

import { Button, Notice } from "@/primitives";
import { api } from "@/utils/api";
import { errorMessage } from "@/utils/axios";
import { formatMoney } from "@/utils/format";

/**
 * Pays an invoice's remaining balance with Paystack. Asks the server for a
 * charge, then sends the customer to Paystack; they come back to this page,
 * which shows the invoice as it is by then.
 *
 * On phones the one action is pinned to the bottom edge, as on the service
 * page; from `lg` it is a large button under the document. A refusal (the
 * invoice was paid or voided meanwhile) shows right above the button.
 */
export function PayInvoiceButton({
  publicId,
  amount,
  currency,
}: {
  publicId: string;
  amount: number;
  currency: string;
}) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setError(null);
    setIsPending(true);
    try {
      const { paymentUrl } = await api.public.payInvoice(publicId);
      // Stay pending: the browser is leaving for Paystack.
      window.location.assign(paymentUrl);
    } catch (caught) {
      setIsPending(false);
      setError(errorMessage(caught));
    }
  }

  const label = `Pay ${formatMoney(amount, currency)} with Paystack`;

  return (
    <>
      {/* From lg: a large button under the document. */}
      <div className="animate-rise-3 mt-8 hidden lg:block">
        {error ? (
          <Notice tone="danger" className="mb-3">
            {error}
          </Notice>
        ) : null}
        <Button size="lg" isLoading={isPending} onClick={pay}>
          {label}
        </Button>
      </div>

      {/* Phone: the one action, pinned to the bottom edge. */}
      <div className="border-line bg-canvas/92 fixed inset-x-0 bottom-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
        {error ? (
          <Notice tone="danger" className="mb-3">
            {error}
          </Notice>
        ) : null}
        <Button size="lg" className="w-full" isLoading={isPending} onClick={pay}>
          {label}
        </Button>
      </div>
    </>
  );
}

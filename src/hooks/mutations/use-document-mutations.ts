import { useMutation, useQueryClient } from "@tanstack/react-query";

import { dashboardKeys } from "@/hooks/queries/use-dashboard";
import { invoiceKeys } from "@/hooks/queries/use-invoices";
import { receiptKeys } from "@/hooks/queries/use-receipts";
import {
  api,
  type InvoiceCreateInput,
  type InvoicePaymentInput,
  type ReceiptCreateInput,
} from "@/utils/api";

/** Invoices and receipts both feed the dashboard's numbers. */
function useInvalidateMoney() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
    void queryClient.invalidateQueries({ queryKey: receiptKeys.all });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
  };
}

export function useCreateInvoiceMutation() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (values: InvoiceCreateInput) => api.invoices.create(values),
    onSuccess: invalidate,
  });
}

/**
 * Records money against an invoice and, optionally, issues a receipt for that
 * payment in the same step.
 */
export function useRecordPaymentMutation() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: async ({
      slug,
      payment,
      receipt,
    }: {
      slug: string;
      payment: InvoicePaymentInput;
      receipt?: ReceiptCreateInput;
    }) => {
      const invoice = await api.invoices.recordPayment(slug, payment);
      const created = receipt ? await api.receipts.create(receipt) : null;
      return { invoice, receipt: created };
    },
    onSuccess: invalidate,
  });
}

export function useSetInvoiceStatusMutation() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ slug, status }: { slug: string; status: "SENT" | "VOID" }) =>
      api.invoices.setStatus(slug, status),
    onSuccess: invalidate,
  });
}

export function useRemoveInvoiceMutation() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (slug: string) => api.invoices.remove(slug),
    onSuccess: invalidate,
  });
}

export function useCreateReceiptMutation() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (values: ReceiptCreateInput) => api.receipts.create(values),
    onSuccess: invalidate,
  });
}

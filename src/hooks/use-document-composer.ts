import { useState } from "react";

import type { DocumentFormSchema } from "@/backend/validators/document-form.validator";
import type { CreatedDocument, DocumentKind } from "@/components/documents/document-modal";
import {
  useCreateInvoiceMutation,
  useCreateReceiptMutation,
} from "@/hooks/mutations/use-document-mutations";
import { errorMessage } from "@/utils/axios";
import { toDocumentPayload } from "@/utils/documents";

/**
 * Opening, submitting and resetting the new-invoice / new-receipt modal, so
 * every page that offers "New invoice" behaves the same. Spread `modal` onto
 * <DocumentModal> (it includes the remount `key`).
 */
export function useDocumentComposer(kind: DocumentKind, currency: string) {
  const [session, setSession] = useState(0);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreatedDocument | null>(null);
  const createInvoice = useCreateInvoiceMutation();
  const createReceipt = useCreateReceiptMutation();
  const mutation = kind === "invoice" ? createInvoice : createReceipt;

  function start() {
    createInvoice.reset();
    createReceipt.reset();
    setCreated(null);
    setSession((n) => n + 1);
    setOpen(true);
  }

  function submit(values: DocumentFormSchema, { draft }: { draft: boolean }) {
    const base = toDocumentPayload(values, currency);
    if (kind === "invoice") {
      createInvoice.mutate(
        {
          ...base,
          status: draft ? "DRAFT" : "SENT",
          amountPaid: 0,
          sentAt: draft ? undefined : new Date().toISOString(),
          dueAt: values.dueAt ? `${values.dueAt}T00:00:00.000Z` : undefined,
        },
        {
          onSuccess: (invoice) =>
            setCreated({
              number: invoice.invoiceNumber,
              shareUrl: invoice.shareUrl,
              url: invoice.url,
              total: Number(invoice.total),
              customer: invoice.clientName,
            }),
        },
      );
      return;
    }
    createReceipt.mutate(
      { ...base, amountPaid: base.total, paymentMethod: values.paymentMethod },
      {
        onSuccess: (receipt) =>
          setCreated({
            number: receipt.receiptNumber,
            shareUrl: receipt.shareUrl,
            url: receipt.url,
            total: Number(receipt.total),
            customer: receipt.name ?? base.name,
          }),
      },
    );
  }

  return {
    start,
    modal: {
      key: `${kind}-${session}`,
      kind,
      open,
      onOpenChange: setOpen,
      currency,
      onSubmit: submit,
      isPending: mutation.isPending,
      error: mutation.isError ? errorMessage(mutation.error) : null,
      created,
    },
  };
}

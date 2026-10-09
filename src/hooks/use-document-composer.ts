import { useState } from "react";
import type { InvoiceDto, ReceiptDto } from "types";

import type { DocumentFormSchema } from "@/backend/validators/document-form.validator";
import type {
  CreatedDocument,
  DocumentKind,
} from "@/components/documents/document-modal";
import {
  useCreateInvoiceMutation,
  useCreateReceiptMutation,
  useUpdateInvoiceMutation,
  useUpdateReceiptMutation,
} from "@/hooks/mutations/use-document-mutations";
import { errorMessage } from "@/utils/axios";
import { toDocumentPayload } from "@/utils/documents";

function isDocument(doc: unknown): doc is InvoiceDto | ReceiptDto {
  return (
    typeof doc === "object" &&
    doc !== null &&
    ("invoiceNumber" in doc || "receiptNumber" in doc)
  );
}

/**
 * Opening, submitting and resetting the invoice/receipt modal (for both creation
 * and editing), so every page that offers invoice/receipt creation or editing
 * behaves the same. Spread `modal` onto <DocumentModal> (it includes the remount `key`).
 */
export function useDocumentComposer(kind: DocumentKind, currency: string) {
  const [session, setSession] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InvoiceDto | ReceiptDto | null>(null);
  const [created, setCreated] = useState<CreatedDocument | null>(null);

  const createInvoice = useCreateInvoiceMutation();
  const createReceipt = useCreateReceiptMutation();
  const updateInvoice = useUpdateInvoiceMutation();
  const updateReceipt = useUpdateReceiptMutation();

  const activeMutation = editing
    ? kind === "invoice"
      ? updateInvoice
      : updateReceipt
    : kind === "invoice"
      ? createInvoice
      : createReceipt;

  function start(doc?: InvoiceDto | ReceiptDto): void;
  function start(event: unknown): void;
  function start(doc?: unknown) {
    createInvoice.reset();
    createReceipt.reset();
    updateInvoice.reset();
    updateReceipt.reset();
    setCreated(null);
    setEditing(isDocument(doc) ? doc : null);
    setSession((n) => n + 1);
    setOpen(true);
  }

  function submit(values: DocumentFormSchema, { draft }: { draft: boolean }) {
    const base = toDocumentPayload(values, currency);

    if (editing) {
      if (kind === "invoice") {
        const inv = editing as InvoiceDto;
        const willBeSent = inv.status === "DRAFT" ? !draft : true;
        updateInvoice.mutate(
          {
            slug: inv.slug,
            values: {
              ...base,
              status: willBeSent ? "SENT" : "DRAFT",
              dueAt: values.dueAt ? `${values.dueAt}T00:00:00.000Z` : undefined,
              sentAt:
                inv.status === "DRAFT" && willBeSent
                  ? new Date().toISOString()
                  : undefined,
            },
          },
          {
            onSuccess: () => setOpen(false),
          },
        );
      } else {
        const rcp = editing as ReceiptDto;
        updateReceipt.mutate(
          {
            slug: rcp.slug,
            values: {
              ...base,
              amountPaid: base.total,
              paymentMethod: values.paymentMethod,
            },
          },
          {
            onSuccess: () => setOpen(false),
          },
        );
      }
      return;
    }

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
      key: `${kind}-${editing ? "edit-" + ("invoiceNumber" in editing ? editing.invoiceNumber : editing.receiptNumber) : "new"}-${session}`,
      kind,
      open,
      onOpenChange: setOpen,
      currency,
      editing,
      onSubmit: submit,
      isPending: activeMutation.isPending,
      error: activeMutation.isError ? errorMessage(activeMutation.error) : null,
      created,
    },
  };
}

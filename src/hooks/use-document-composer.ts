import { useState } from "react";
import type { InvoiceDto, ProductDto, ReceiptDto } from "types";

import { optionLabel } from "@/utils/labels";

import type { DocumentFormSchema } from "@/backend/validators/document-form.validator";
import type {
  CreatedDocument,
  CustomerPrefill,
  DocumentKind,
  DocumentSubmitOptions,
} from "@/components/documents/document-modal";
import {
  useCreateInvoiceMutation,
  useCreateReceiptMutation,
  useUpdateInvoiceMutation,
  useUpdateReceiptMutation,
} from "@/hooks/mutations/use-document-mutations";
import { errorMessage } from "@/utils/axios";
import { toDocumentPayload, toSale } from "@/utils/documents";

function isDocument(doc: unknown): doc is InvoiceDto | ReceiptDto {
  return (
    typeof doc === "object" &&
    doc !== null &&
    ("invoiceNumber" in doc || "receiptNumber" in doc)
  );
}

type StockLine = { productOptionId?: string; quantity: string };

/**
 * The warning for a receipt that sells more of a product option than is in
 * stock, e.g. "Only 9 Shea butter 250ml in stock", or null when it all fits.
 * Lines for the same option add up. Made-to-order products never warn. It only
 * warns: the owner can still save (the shop may be behind on its counts).
 */
export function stockWarning(lines: StockLine[], products: ProductDto[]): string | null {
  const wanted = new Map<string, number>();
  for (const line of lines) {
    if (!line.productOptionId) continue;
    const quantity = Number(line.quantity);
    if (!(quantity >= 1)) continue;
    wanted.set(line.productOptionId, (wanted.get(line.productOptionId) ?? 0) + quantity);
  }

  for (const product of products) {
    if (!product.tracksStock) continue;
    for (const option of product.options) {
      const quantity = wanted.get(option.id);
      if (quantity === undefined || quantity <= option.stock) continue;
      const label = optionLabel(product.name, option.name);
      return option.stock <= 0 ? `${label} is sold out` : `Only ${option.stock} ${label} in stock`;
    }
  }
  return null;
}

/** The same warning for one row, so the form can show it under that row. */
export function lineStockWarning(line: StockLine, products: ProductDto[]): string | null {
  return stockWarning([line], products);
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
  const [customer, setCustomer] = useState<CustomerPrefill | null>(null);

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

  function start(doc?: InvoiceDto | ReceiptDto, customer?: CustomerPrefill | null): void;
  function start(event: unknown): void;
  function start(doc?: unknown, customer?: CustomerPrefill | null) {
    createInvoice.reset();
    createReceipt.reset();
    updateInvoice.reset();
    updateReceipt.reset();
    setCreated(null);
    const editingDoc = isDocument(doc) ? doc : null;
    setEditing(editingDoc);
    setCustomer(editingDoc ? null : (customer ?? null));
    setSession((n) => n + 1);
    setOpen(true);
  }

  function submit(values: DocumentFormSchema, { draft, customerId }: DocumentSubmitOptions) {
    const base = {
      ...toDocumentPayload(values, currency),
      ...(customerId ? { customerId } : {}),
    };

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

    const sale = toSale(values);
    createReceipt.mutate(
      {
        ...base,
        amountPaid: base.total,
        paymentMethod: values.paymentMethod,
        ...(sale ? { sale } : {}),
      },
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
      customer,
      onSubmit: submit,
      isPending: activeMutation.isPending,
      error: activeMutation.isError ? errorMessage(activeMutation.error) : null,
      created,
    },
  };
}

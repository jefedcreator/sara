"use client";

import { Plus } from "@phosphor-icons/react/dist/ssr";
import { useQueryStates } from "nuqs";
import { useState } from "react";
import type { InvoiceDto, Page, ServiceDto } from "types";

import type { PaymentFormSchema } from "@/backend/validators/document-form.validator";
import { DOCUMENT_GRID, DocumentCardSkeleton } from "@/components/documents/document-card";
import { DocumentModal } from "@/components/documents/document-modal";
import {
  useRecordPaymentMutation,
  useRemoveInvoiceMutation,
  useSetInvoiceStatusMutation,
} from "@/hooks/mutations/use-document-mutations";
import { useInvoicesQuery } from "@/hooks/queries/use-invoices";
import { useDocumentComposer } from "@/hooks/use-document-composer";
import { Button, ConfirmModal, Notice, Pager, Segmented } from "@/primitives";
import { parseMoney } from "@/backend/validators/document-form.validator";
import type { InvoiceListParams } from "@/utils/api";
import { errorMessage } from "@/utils/axios";
import { cn } from "@/utils/cn";
import { publicPath } from "@/utils/public-links";
import { invoiceListParams, invoicesParams, type InvoiceView } from "@/utils/url-state";

import { InvoiceRow } from "./invoice-row";
import { outstandingOf, PaymentModal } from "./payment-modal";

const VIEWS: { value: InvoiceView; label: string }[] = [
  { value: "unpaid", label: "Unpaid" },
  { value: "paid", label: "Paid" },
  { value: "draft", label: "Drafts" },
  { value: "void", label: "Void" },
  { value: "all", label: "All" },
];

const EMPTY: Record<InvoiceView, string> = {
  unpaid: "No unpaid invoices. You're all settled up.",
  paid: "Paid invoices show here once you record the payment.",
  draft: "No drafts.",
  void: "No voided invoices.",
  all: "No invoices yet.",
};

type Confirm = { kind: "void" | "delete"; invoice: InvoiceDto };

interface InvoicesPageClientProps {
  currency: string;
  services: ServiceDto[];
  publicBaseUrl: string;
  initial: { params: InvoiceListParams; data: Page<InvoiceDto> };
}

export function InvoicesPageClient({ currency, services, publicBaseUrl, initial }: InvoicesPageClientProps) {
  const [{ view, page }, setUrl] = useQueryStates(invoicesParams, { history: "push" });
  const params = invoiceListParams(view, page);
  const query = useInvoicesQuery(params, initial);
  const composer = useDocumentComposer("invoice", currency);
  const recordPayment = useRecordPaymentMutation();
  const setStatus = useSetInvoiceStatusMutation();
  const remove = useRemoveInvoiceMutation();

  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "danger"; text: string; url?: string } | null>(null);
  // Kept after closing so the modals keep their content while animating out.
  const [paying, setPaying] = useState<InvoiceDto | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payKey, setPayKey] = useState(0);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function pay(invoice: InvoiceDto, values: PaymentFormSchema) {
    const amount = parseMoney(values.amount);
    const amountPaid = Math.round((Number(invoice.amountPaid) + amount) * 100) / 100;
    const settled = amount >= outstandingOf(invoice) - 0.001;
    recordPayment.mutate(
      {
        slug: invoice.slug,
        payment: {
          status: settled ? "PAID" : "PARTIALLY_PAID",
          amountPaid: settled ? Number(invoice.total) : amountPaid,
          paidAt: settled ? new Date().toISOString() : undefined,
        },
        receipt: values.withReceipt
          ? {
              name: invoice.clientName,
              email: invoice.clientEmail ?? undefined,
              phone: invoice.clientPhone ?? undefined,
              currency: invoice.currency,
              subtotal: amount,
              taxAmount: 0,
              discount: 0,
              total: amount,
              amountPaid: amount,
              paymentMethod: values.paymentMethod,
              notes: `Payment for ${invoice.invoiceNumber}`,
            }
          : undefined,
      },
      {
        onSuccess: ({ receipt }) => {
          setPayOpen(false);
          setNotice({
            tone: "info",
            text: receipt
              ? `Payment recorded. Receipt ${receipt.receiptNumber} is ready.`
              : "Payment recorded.",
            url: receipt?.url ?? undefined,
          });
        },
      },
    );
  }

  function markSent(invoice: InvoiceDto) {
    setNotice(null);
    setBusySlug(invoice.slug);
    setStatus.mutate(
      { slug: invoice.slug, status: "SENT" },
      {
        onError: (error) => setNotice({ tone: "danger", text: errorMessage(error) }),
        onSettled: () => setBusySlug(null),
      },
    );
  }

  function confirmAction() {
    if (!confirm) return;
    const done = { onSuccess: () => setConfirmOpen(false) };
    if (confirm.kind === "void") {
      setStatus.mutate({ slug: confirm.invoice.slug, status: "VOID" }, done);
    } else {
      remove.mutate(confirm.invoice.slug, done);
    }
  }

  const confirmMutation = confirm?.kind === "void" ? setStatus : remove;
  const rows = query.data?.data ?? [];

  return (
    <div className="grid grid-cols-1 gap-6">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-display text-[clamp(1.9rem,1.3rem+2.2vw,3rem)] leading-[1.06] font-normal tracking-[-0.035em]">
            Invoices
          </h1>
          <p className="text-muted mt-2 max-w-[52ch] text-pretty">
            Every invoice gets a PDF link to send your customer. Record payments as they come in.
          </p>
        </div>
        <Button onClick={composer.start}>
          <Plus weight="bold" />
          New invoice
        </Button>
      </header>

      <Segmented
        label="Show"
        value={view}
        options={VIEWS}
        onChange={(next) => void setUrl({ view: next, page: 1 })}
      />

      {notice ? (
        <Notice tone={notice.tone}>
          {notice.text}{" "}
          {notice.url ? (
            <a href={notice.url} target="_blank" rel="noopener" className="font-semibold underline underline-offset-4">
              Open PDF
            </a>
          ) : null}
        </Notice>
      ) : null}

      {query.isPending ? (
        <div className={DOCUMENT_GRID}>
          {Array.from({ length: 3 }, (_, i) => (
            <DocumentCardSkeleton key={i} />
          ))}
        </div>
      ) : query.isError ? (
        <Notice tone="danger">Invoices didn&apos;t load. Refresh to try again.</Notice>
      ) : rows.length === 0 ? (
        <p className="rounded-card bg-surface text-muted px-5 py-6 text-[15px]">{EMPTY[view]}</p>
      ) : (
        <ul className={cn(DOCUMENT_GRID, query.isPlaceholderData && "opacity-60")}>
          {rows.map((invoice) => (
            <li key={invoice.id} className="grid grid-cols-1">
              <InvoiceRow
                invoice={invoice}
                link={`${publicBaseUrl}${publicPath("invoice", invoice.publicId)}`}
                busy={busySlug === invoice.slug}
                onEdit={() => composer.start(invoice)}
                onRecordPayment={() => {
                  recordPayment.reset();
                  setPaying(invoice);
                  setPayKey((k) => k + 1);
                  setPayOpen(true);
                }}
                onSend={() => markSent(invoice)}
                onVoid={() => {
                  setStatus.reset();
                  setConfirm({ kind: "void", invoice });
                  setConfirmOpen(true);
                }}
                onDelete={() => {
                  remove.reset();
                  setConfirm({ kind: "delete", invoice });
                  setConfirmOpen(true);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <Pager
        page={page}
        totalPages={query.data?.totalPages ?? 1}
        onChange={(next) => void setUrl({ page: next })}
      />

      <DocumentModal {...composer.modal} services={services.filter((s) => s.isActive)} />

      {paying ? (
        <PaymentModal
          key={payKey}
          invoice={paying}
          open={payOpen}
          onOpenChange={setPayOpen}
          onSubmit={(values) => pay(paying, values)}
          isPending={recordPayment.isPending}
          error={recordPayment.isError ? errorMessage(recordPayment.error) : null}
        />
      ) : null}

      <ConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          confirm?.kind === "void"
            ? `Void ${confirm.invoice.invoiceNumber}?`
            : `Delete ${confirm?.invoice.invoiceNumber ?? "invoice"}?`
        }
        description={
          confirmMutation.isError
            ? errorMessage(confirmMutation.error)
            : confirm?.kind === "void"
              ? "It stops counting as unpaid. The PDF link still works, so tell your customer it's cancelled."
              : "It's removed for good, along with its PDF link."
        }
        confirmLabel={confirm?.kind === "void" ? "Void invoice" : "Delete invoice"}
        tone="danger"
        isPending={confirmMutation.isPending}
        onConfirm={confirmAction}
      />
    </div>
  );
}

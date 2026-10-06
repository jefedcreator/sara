"use client";

import { Plus } from "@phosphor-icons/react/dist/ssr";
import { useQueryStates } from "nuqs";
import type { Page, ReceiptDto, ServiceDto } from "types";

import { CopyLinkButton } from "@/app/components/landing/CopyLinkButton";
import { DocumentModal } from "@/components/documents/document-modal";
import { useReceiptsQuery } from "@/hooks/queries/use-receipts";
import { useDocumentComposer } from "@/hooks/use-document-composer";
import { Button, Notice, Pager, Skeleton, StatusPill } from "@/primitives";
import { formatMoney } from "@/utils/format";
import { formatDate, PAYMENT_METHOD } from "@/utils/labels";
import { publicPath } from "@/utils/public-links";
import { receiptsParams } from "@/utils/url-state";

interface ReceiptsPageClientProps {
  currency: string;
  services: ServiceDto[];
  publicBaseUrl: string;
  initial: { page: number; data: Page<ReceiptDto> };
}

/**
 * Proof of payment. Paystack payments get one automatically; cash and
 * transfers are added here (or from an invoice's "Record payment").
 */
export function ReceiptsPageClient({ currency, services, publicBaseUrl, initial }: ReceiptsPageClientProps) {
  const [{ page }, setUrl] = useQueryStates(receiptsParams, { history: "push" });
  const query = useReceiptsQuery(page, initial);
  const composer = useDocumentComposer("receipt", currency);
  const rows = query.data?.data ?? [];

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-display text-[clamp(1.9rem,1.3rem+2.2vw,3rem)] leading-[1.06] font-normal tracking-[-0.035em]">
            Receipts
          </h1>
          <p className="text-muted mt-2 max-w-[52ch] text-pretty">
            Paystack payments get a receipt automatically. Add one here for cash or a transfer.
          </p>
        </div>
        <Button onClick={composer.start}>
          <Plus weight="bold" />
          New receipt
        </Button>
      </header>

      {query.isPending ? (
        <div className="grid gap-2.5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="rounded-card h-[76px]" />
          ))}
        </div>
      ) : query.isError ? (
        <Notice tone="danger">Receipts didn&apos;t load. Refresh to try again.</Notice>
      ) : rows.length === 0 ? (
        <p className="rounded-card bg-surface text-muted px-5 py-6 text-[15px]">
          No receipts yet. They appear here when customers pay through your booking links.
        </p>
      ) : (
        <ul className={query.isPlaceholderData ? "grid gap-2.5 opacity-60" : "grid gap-2.5"}>
          {rows.map((receipt) => {
            const invoice = receipt.payment?.invoice;
            return (
              <li
                key={receipt.id}
                className="rounded-card bg-surface flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15px] font-semibold">{receipt.name ?? "Customer"}</h3>
                    {receipt.paymentMethod ? (
                      <StatusPill tone="muted">{PAYMENT_METHOD[receipt.paymentMethod]}</StatusPill>
                    ) : null}
                  </div>
                  <p className="text-muted mt-0.5 text-sm">
                    {receipt.receiptNumber} · {formatDate(receipt.createdAt)}
                    {invoice ? ` · for ${invoice.invoiceNumber}` : ""}
                  </p>
                </div>
                <span className="text-[17px] font-semibold whitespace-nowrap">
                  {formatMoney(receipt.amountPaid, receipt.currency)}
                </span>
                <CopyLinkButton
                  url={`${publicBaseUrl}${publicPath("receipt", receipt.publicId)}`}
                  label="Copy link"
                  tone="quiet"
                  className="h-10"
                />
                {receipt.url ? (
                  <Button asChild size="sm" variant="secondary">
                    <a href={receipt.url} target="_blank" rel="noopener">
                      PDF
                    </a>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Pager
        page={page}
        totalPages={query.data?.totalPages ?? 1}
        onChange={(next) => void setUrl({ page: next })}
      />

      <DocumentModal {...composer.modal} services={services.filter((s) => s.isActive)} />
    </div>
  );
}

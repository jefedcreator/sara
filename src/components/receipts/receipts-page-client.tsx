"use client";

import { Plus } from "@phosphor-icons/react/dist/ssr";
import { useQueryStates } from "nuqs";
import type { Page, ReceiptDto, ServiceDto } from "types";

import { DocumentModal } from "@/components/documents/document-modal";
import { useReceiptsQuery } from "@/hooks/queries/use-receipts";
import { useDocumentComposer } from "@/hooks/use-document-composer";
import { Button, Notice, Pager, Skeleton } from "@/primitives";
import { publicPath } from "@/utils/public-links";
import { receiptsParams } from "@/utils/url-state";

import { ReceiptRow } from "./receipt-row";

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
          {rows.map((receipt) => (
            <li key={receipt.id}>
              <ReceiptRow
                receipt={receipt}
                link={`${publicBaseUrl}${publicPath("receipt", receipt.publicId)}`}
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
    </div>
  );
}

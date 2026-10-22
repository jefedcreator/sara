"use client";

import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { useQueryStates } from "nuqs";
import { useEffect, useState } from "react";
import type { CustomerListItem, Page } from "types";

import { useCustomersQuery } from "@/hooks/queries/use-customers";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { Input, Notice, Pager, Skeleton } from "@/primitives";
import type { CustomerListParams } from "@/utils/api";
import { errorMessage } from "@/utils/axios";
import { cn } from "@/utils/cn";
import { customersParams } from "@/utils/url-state";

import { CustomerRow } from "./customer-row";

interface CustomersPageClientProps {
  currency: string;
  initial: { params: CustomerListParams; data: Page<CustomerListItem> };
}

export function CustomersPageClient({ currency, initial }: CustomersPageClientProps) {
  const [{ query, page }, setUrl] = useQueryStates(customersParams, {
    history: "replace",
  });
  const [term, setTerm] = useState(query);
  const debouncedTerm = useDebouncedValue(term, 250);
  const params: CustomerListParams = {
    query: query.trim() || undefined,
    page,
  };
  const customersQuery = useCustomersQuery(params, initial);

  useEffect(() => {
    if (debouncedTerm === query) return;
    void setUrl({ query: debouncedTerm, page: 1 });
  }, [debouncedTerm, query, setUrl]);

  const rows = customersQuery.data?.data ?? [];
  const searching = query.trim().length > 0;

  return (
    <div className="grid grid-cols-1 gap-6">
      <header>
        <h1 className="font-display text-[clamp(1.9rem,1.3rem+2.2vw,3rem)] leading-[1.06] font-normal tracking-[-0.035em]">
          Customers
        </h1>
        <p className="text-muted mt-2 max-w-[52ch] text-pretty">
          Everyone who books, buys or gets an invoice. Search by name, phone or
          email.
        </p>
      </header>

      <div className="relative">
        <MagnifyingGlass
          aria-hidden="true"
          weight="bold"
          className="text-muted pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          aria-label="Search customers"
          placeholder="Search by name, phone or email"
          autoComplete="off"
          className="pl-10"
        />
      </div>

      {customersQuery.isPending ? (
        <div className="grid gap-2.5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="rounded-card h-[88px]" />
          ))}
        </div>
      ) : customersQuery.isError ? (
        <Notice tone="danger">{errorMessage(customersQuery.error)}</Notice>
      ) : rows.length === 0 ? (
        <p className="rounded-card bg-surface text-muted px-5 py-6 text-[15px]">
          {searching
            ? `No customers match “${query.trim()}”.`
            : "Customers appear here as you book, invoice and sell."}
        </p>
      ) : (
        <ul
          className={cn(
            "grid gap-2.5",
            customersQuery.isPlaceholderData && "opacity-60",
          )}
        >
          {rows.map((customer) => (
            <li key={customer.id}>
              <CustomerRow customer={customer} currency={currency} />
            </li>
          ))}
        </ul>
      )}

      <Pager
        page={page}
        totalPages={customersQuery.data?.totalPages ?? 1}
        onChange={(next) => void setUrl({ page: next })}
      />
    </div>
  );
}

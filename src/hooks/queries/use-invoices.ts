import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { InvoiceDto, Page } from "types";

import { api, type InvoiceListParams } from "@/utils/api";

export const invoiceKeys = {
  all: ["invoices"] as const,
  lists: () => [...invoiceKeys.all, "list"] as const,
  list: (params: InvoiceListParams) => [...invoiceKeys.lists(), params] as const,
};

export function useInvoicesQuery(
  params: InvoiceListParams,
  initial?: { params: InvoiceListParams; data: Page<InvoiceDto> },
) {
  const seeded = initial && JSON.stringify(initial.params) === JSON.stringify(params);
  return useQuery({
    queryKey: invoiceKeys.list(params),
    queryFn: () => api.invoices.list(params),
    initialData: seeded ? initial.data : undefined,
    placeholderData: keepPreviousData,
  });
}

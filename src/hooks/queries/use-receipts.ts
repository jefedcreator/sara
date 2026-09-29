import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Page, ReceiptDto } from "types";

import { api } from "@/utils/api";

export const receiptKeys = {
  all: ["receipts"] as const,
  lists: () => [...receiptKeys.all, "list"] as const,
  list: (page: number) => [...receiptKeys.lists(), { page }] as const,
};

export function useReceiptsQuery(page: number, initial?: { page: number; data: Page<ReceiptDto> }) {
  return useQuery({
    queryKey: receiptKeys.list(page),
    queryFn: () => api.receipts.list({ page }),
    initialData: initial?.page === page ? initial.data : undefined,
    placeholderData: keepPreviousData,
  });
}

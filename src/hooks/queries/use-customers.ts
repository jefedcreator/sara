import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CustomerDetail, CustomerListItem, Page } from "types";

import { api, type CustomerListParams } from "@/utils/api";

export const customerKeys = {
  all: ["customers"] as const,
  lists: () => [...customerKeys.all, "list"] as const,
  list: (params: CustomerListParams) => [...customerKeys.lists(), params] as const,
  details: () => [...customerKeys.all, "detail"] as const,
  detail: (id: string) => [...customerKeys.details(), id] as const,
};

export function useCustomersQuery(
  params: CustomerListParams,
  initial?: { params: CustomerListParams; data: Page<CustomerListItem> },
  options?: { enabled?: boolean },
) {
  const seeded =
    initial && JSON.stringify(initial.params) === JSON.stringify(params);
  return useQuery({
    queryKey: customerKeys.list(params),
    queryFn: () => api.customers.list(params),
    initialData: seeded ? initial.data : undefined,
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

export function useCustomerQuery(id: string, initial?: CustomerDetail) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: () => api.customers.get(id),
    initialData: initial?.id === id ? initial : undefined,
    enabled: Boolean(id),
  });
}

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { OrderDto, Page } from "types";

import { api, type OrderListParams } from "@/utils/api";

export const orderKeys = {
  all: ["orders"] as const,
  lists: () => [...orderKeys.all, "list"] as const,
  list: (params: OrderListParams) => [...orderKeys.lists(), params] as const,
  details: () => [...orderKeys.all, "detail"] as const,
  detail: (slug: string) => [...orderKeys.details(), slug] as const,
};

/** `initial` seeds only the params the server rendered. */
export function useOrdersQuery(
  params: OrderListParams,
  initial?: { params: OrderListParams; data: Page<OrderDto> },
) {
  const seeded = initial && JSON.stringify(initial.params) === JSON.stringify(params);
  return useQuery({
    queryKey: orderKeys.list(params),
    queryFn: () => api.orders.list(params),
    initialData: seeded ? initial.data : undefined,
    placeholderData: keepPreviousData,
  });
}

export function useOrderQuery(slug: string, initial?: OrderDto) {
  return useQuery({
    queryKey: orderKeys.detail(slug),
    queryFn: () => api.orders.get(slug),
    initialData: initial?.slug === slug ? initial : undefined,
    enabled: Boolean(slug),
  });
}

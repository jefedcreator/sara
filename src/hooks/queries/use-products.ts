import { useQuery } from "@tanstack/react-query";
import type { ProductDto } from "types";

import { api } from "@/utils/api";

export const productKeys = {
  all: ["products"] as const,
  lists: () => [...productKeys.all, "list"] as const,
};

export function useProductsQuery(initialData?: ProductDto[]) {
  return useQuery({
    queryKey: productKeys.lists(),
    queryFn: api.products.list,
    initialData,
  });
}

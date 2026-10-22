import { useMutation, useQueryClient } from "@tanstack/react-query";

import { productKeys } from "@/hooks/queries/use-products";
import { api, type ProductInput, type StockAdjustInput } from "@/utils/api";

export function useCreateProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ values, photos }: { values: ProductInput; photos: File[] }) =>
      api.products.create(values, photos),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export function useUpdateProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      values,
      photos = [],
      keepPhotos,
    }: {
      slug: string;
      values: Partial<ProductInput> & { isActive?: boolean };
      photos?: File[];
      keepPhotos?: string[];
    }) => api.products.update(slug, values, photos, keepPhotos),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export function useAdjustStockMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      input,
    }: {
      slug: string;
      input: StockAdjustInput;
    }) => api.products.adjustStock(slug, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

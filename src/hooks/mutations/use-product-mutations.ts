import { useMutation, useQueryClient } from "@tanstack/react-query";

import { dashboardKeys } from "@/hooks/queries/use-dashboard";
import { productKeys } from "@/hooks/queries/use-products";
import { api, type ProductInput, type StockAdjustInput } from "@/utils/api";

/** A product's stock and whether it's live feed Today's "Running low" as well as the list. */
function useInvalidateProducts() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: productKeys.all });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
  };
}

export function useCreateProductMutation() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({ values, photos }: { values: ProductInput; photos: File[] }) =>
      api.products.create(values, photos),
    onSuccess: invalidate,
  });
}

export function useUpdateProductMutation() {
  const invalidate = useInvalidateProducts();
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
    onSuccess: invalidate,
  });
}

export function useAdjustStockMutation() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({
      slug,
      input,
    }: {
      slug: string;
      input: StockAdjustInput;
    }) => api.products.adjustStock(slug, input),
    onSuccess: invalidate,
  });
}

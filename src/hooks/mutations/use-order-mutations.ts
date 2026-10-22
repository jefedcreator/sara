import { useMutation, useQueryClient } from "@tanstack/react-query";

import { customerKeys } from "@/hooks/queries/use-customers";
import { dashboardKeys } from "@/hooks/queries/use-dashboard";
import { orderKeys } from "@/hooks/queries/use-orders";
import { productKeys } from "@/hooks/queries/use-products";
import { api, type OrderUpdateInput } from "@/utils/api";

/** Moving, cancelling or re-routing an order changes the queue, Today, the customer's timeline and (on cancel) stock. */
export function useUpdateOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, values }: { slug: string; values: OrderUpdateInput }) =>
      api.orders.update(slug, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

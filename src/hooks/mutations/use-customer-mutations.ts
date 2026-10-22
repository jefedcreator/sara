import { useMutation, useQueryClient } from "@tanstack/react-query";

import { customerKeys } from "@/hooks/queries/use-customers";
import {
  api,
  type CustomerMergeInput,
  type CustomerUpdateInput,
} from "@/utils/api";

export function useUpdateCustomerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: CustomerUpdateInput }) =>
      api.customers.update(id, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useMergeCustomersMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CustomerMergeInput) => api.customers.merge(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

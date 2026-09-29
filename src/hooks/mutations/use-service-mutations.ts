import { useMutation, useQueryClient } from "@tanstack/react-query";

import { serviceKeys } from "@/hooks/queries/use-services";
import { api, type ServiceFormInput } from "@/utils/api";

export function useCreateServiceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ values, image }: { values: ServiceFormInput; image?: File }) =>
      api.services.create(values, image),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: serviceKeys.all });
    },
  });
}

export function useUpdateServiceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      values,
      image,
    }: {
      slug: string;
      values: Partial<ServiceFormInput> & { isActive?: boolean };
      image?: File;
    }) => api.services.update(slug, values, image),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: serviceKeys.all });
    },
  });
}

export function useRemoveServiceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.services.remove(slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: serviceKeys.all });
    },
  });
}

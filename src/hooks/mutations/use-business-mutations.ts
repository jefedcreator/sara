import { useMutation, useQueryClient } from "@tanstack/react-query";

import { businessKeys } from "@/hooks/queries/use-business";
import {
  api,
  type BusinessCreateInput,
  type BusinessHoursInput,
  type BusinessUpdateInput,
} from "@/utils/api";

export function useCreateBusinessMutation() {
  return useMutation({
    mutationFn: (values: BusinessCreateInput) => api.business.create(values),
  });
}

export function useUpdateBusinessMutation() {
  return useMutation({
    mutationFn: (values: BusinessUpdateInput) => api.business.update(values),
  });
}

export function useSaveHoursMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (days: BusinessHoursInput[]) => api.business.saveHours(days),
    onSuccess: (days) => {
      queryClient.setQueryData(businessKeys.hours(), days);
    },
  });
}

export function useAddClosureMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.business.addClosure,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: businessKeys.closures() });
    },
  });
}

export function useRemoveClosureMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.business.removeClosure,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: businessKeys.closures() });
    },
  });
}

export function useConnectCalendarMutation() {
  return useMutation({
    mutationFn: api.business.calendarConnectUrl,
    onSuccess: ({ authorizationUrl }) => {
      window.location.assign(authorizationUrl);
    },
  });
}

export function useDisconnectCalendarMutation() {
  return useMutation({ mutationFn: api.business.disconnectCalendar });
}

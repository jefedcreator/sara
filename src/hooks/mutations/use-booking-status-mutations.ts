import { useMutation, useQueryClient } from "@tanstack/react-query";

import { bookingKeys } from "@/hooks/queries/use-bookings";
import { dashboardKeys } from "@/hooks/queries/use-dashboard";
import { api, type BookingStatus } from "@/utils/api";

function useInvalidateBookings() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
  };
}

export function useSetBookingStatusMutation() {
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: ({ slug, status }: { slug: string; status: BookingStatus }) =>
      api.bookings.setStatus(slug, status),
    onSuccess: invalidate,
  });
}

export function useRescheduleBookingMutation() {
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: ({ slug, startTime, endTime }: { slug: string; startTime: string; endTime: string }) =>
      api.bookings.reschedule(slug, startTime, endTime),
    onSuccess: invalidate,
  });
}

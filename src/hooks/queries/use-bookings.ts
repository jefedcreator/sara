import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { BookingDto, Page } from "types";

import { api, type BookingListParams } from "@/utils/api";

export const bookingKeys = {
  all: ["bookings"] as const,
  lists: () => [...bookingKeys.all, "list"] as const,
  list: (params: BookingListParams) => [...bookingKeys.lists(), params] as const,
  slots: (serviceSlug: string, date: string) =>
    [...bookingKeys.all, "slots", serviceSlug, date] as const,
};

/** `initial` seeds only the params the server rendered. */
export function useBookingsQuery(
  params: BookingListParams,
  initial?: { params: BookingListParams; data: Page<BookingDto> },
) {
  const seeded = initial && JSON.stringify(initial.params) === JSON.stringify(params);
  return useQuery({
    queryKey: bookingKeys.list(params),
    queryFn: () => api.bookings.list(params),
    initialData: seeded ? initial.data : undefined,
    placeholderData: keepPreviousData,
  });
}

export function useServiceSlotsQuery(serviceSlug: string | null, date: string) {
  return useQuery({
    queryKey: bookingKeys.slots(serviceSlug ?? "", date),
    queryFn: () => api.bookings.slots(serviceSlug!, date),
    enabled: Boolean(serviceSlug),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

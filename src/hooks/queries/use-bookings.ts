import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { BookingDto, Page } from "types";

import { api, type BookingListParams } from "@/utils/api";

export const bookingKeys = {
  all: ["bookings"] as const,
  lists: () => [...bookingKeys.all, "list"] as const,
  list: (params: BookingListParams) => [...bookingKeys.lists(), params] as const,
  slots: (serviceSlug: string, date: string) =>
    [...bookingKeys.all, "slots", serviceSlug, date] as const,
  nights: (slug: string, from: string, to: string, exclude: string) =>
    [...bookingKeys.all, "nights", slug, from, to, exclude] as const,
  pickups: (slug: string, date: string, units: number, exclude: string) =>
    [...bookingKeys.all, "pickups", slug, date, units, exclude] as const,
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

export function useServiceNightsQuery(serviceSlug: string, from: string, to: string, exclude: string, enabled: boolean) {
  return useQuery({
    queryKey: bookingKeys.nights(serviceSlug, from, to, exclude),
    queryFn: () => api.bookings.nights(serviceSlug, from, to, exclude),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

export function useServicePickupsQuery(serviceSlug: string, date: string, units: number, exclude: string, enabled: boolean) {
  return useQuery({
    queryKey: bookingKeys.pickups(serviceSlug, date, units, exclude),
    queryFn: () => api.bookings.pickups(serviceSlug, date, units, exclude),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

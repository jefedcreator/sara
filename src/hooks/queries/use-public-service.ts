import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PublicServiceDto } from "types";

import { api } from "@/utils/api";

export const publicServiceKeys = {
  all: ["public-service"] as const,
  /** Everything loaded for one service: invalidate this after a failed booking. */
  service: (slug: string) => [...publicServiceKeys.all, slug] as const,
  detail: (slug: string, date: string) => [...publicServiceKeys.service(slug), date] as const,
  nights: (slug: string, from: string, to: string) =>
    [...publicServiceKeys.service(slug), "nights", from, to] as const,
  pickups: (slug: string, date: string, units: number) =>
    [...publicServiceKeys.service(slug), "pickups", date, units] as const,
};

// Free time goes quickly; re-check each time it is shown.
const STALE_MS = 30 * 1000;

/**
 * A slot service and its slots for one day. `initial` is the server-rendered
 * day: it seeds only that date's query, and switching days keeps the
 * previous slots on screen until the new ones land.
 */
export function usePublicServiceQuery(
  slug: string,
  date: string,
  initial?: { date: string; data: PublicServiceDto },
) {
  return useQuery({
    queryKey: publicServiceKeys.detail(slug, date),
    queryFn: () => api.public.service(slug, date),
    initialData: initial?.date === date ? initial.data : undefined,
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
  });
}

/** A stay's nights over [from, to). `initial` seeds the server-rendered window. */
export function usePublicNightsQuery(
  slug: string,
  window: { from: string; to: string },
  initial?: PublicServiceDto,
) {
  return useQuery({
    queryKey: publicServiceKeys.nights(slug, window.from, window.to),
    queryFn: () => api.public.nights(slug, window.from, window.to),
    initialData: initial,
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
  });
}

/** A car's pickup times on a day for a rental of `units` days. */
export function usePublicPickupsQuery(slug: string, date: string, units: number, initial?: PublicServiceDto) {
  return useQuery({
    queryKey: publicServiceKeys.pickups(slug, date, units),
    queryFn: () => api.public.pickups(slug, date, units),
    initialData: initial,
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
  });
}

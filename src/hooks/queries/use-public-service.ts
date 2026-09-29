import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PublicServiceDto } from "types";

import { api } from "@/utils/api";

export const publicServiceKeys = {
  all: ["public-service"] as const,
  detail: (slug: string, date: string) =>
    [...publicServiceKeys.all, slug, date] as const,
};

/**
 * A service and its slots for one day. `initial` is the server-rendered day:
 * it seeds only that date's query, and switching days keeps the previous
 * slots on screen until the new ones land.
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
    // Free time goes quickly; re-check a day each time it is picked.
    staleTime: 30 * 1000,
  });
}

import { useQuery } from "@tanstack/react-query";
import type { BusinessClosureDto, BusinessHoursDto } from "types";

import { api } from "@/utils/api";

export const businessKeys = {
  all: ["business"] as const,
  hours: () => [...businessKeys.all, "hours"] as const,
  closures: () => [...businessKeys.all, "closures"] as const,
};

export function useBusinessHoursQuery(initialData?: BusinessHoursDto[]) {
  return useQuery({
    queryKey: businessKeys.hours(),
    queryFn: api.business.hours,
    initialData,
  });
}

export function useClosuresQuery(initialData?: BusinessClosureDto[]) {
  return useQuery({
    queryKey: businessKeys.closures(),
    queryFn: api.business.closures,
    initialData,
  });
}

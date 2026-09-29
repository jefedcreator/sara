import { useQuery } from "@tanstack/react-query";
import type { ServiceDto } from "types";

import { api } from "@/utils/api";

export const serviceKeys = {
  all: ["services"] as const,
  lists: () => [...serviceKeys.all, "list"] as const,
};

export function useServicesQuery(initialData?: ServiceDto[]) {
  return useQuery({
    queryKey: serviceKeys.lists(),
    queryFn: api.services.list,
    initialData,
  });
}

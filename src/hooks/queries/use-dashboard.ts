import { useQuery } from "@tanstack/react-query";
import type { DashboardData } from "types";

import { api } from "@/utils/api";

export const dashboardKeys = {
  all: ["dashboard"] as const,
};

export function useDashboardQuery(initialData?: DashboardData) {
  return useQuery({
    queryKey: dashboardKeys.all,
    queryFn: api.dashboard,
    initialData,
  });
}

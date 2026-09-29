import { cache } from "react";

import { dashboardService } from "@/backend/services/dashboard";

/** The dashboard's data: the same call GET /api/dashboard makes. */
export const getDashboard = cache((businessId: string, currency: string) =>
  dashboardService.load(businessId, currency),
);

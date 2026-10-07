import { api } from "@/lib/api/client";
import type { DashboardData } from "@/types/api-types";

export function getDashboard(): Promise<DashboardData> {
  return api.get<DashboardData>("/dashboard");
}
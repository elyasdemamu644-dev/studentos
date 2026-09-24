import { api } from "@/lib/api/client";
import type { DashboardData } from "@/features/api-types";

export function getDashboard(): Promise<DashboardData> {
  return api.get<DashboardData>("/dashboard");
}
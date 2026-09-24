"use client";

import { useQuery } from "@tanstack/react-query";
import * as api from "./dashboard-api";

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: api.getDashboard,
  });
}
import { api } from "@/lib/api/client";
import type { NotificationsResult, Settings } from "@/features/api-types";

export function getSettings(): Promise<Settings> {
  return api.get<Settings>("/settings");
}

export function updateSettings(settings: Settings): Promise<Settings> {
  return api.patch<Settings>("/settings", { settings });
}

export function listNotifications(): Promise<NotificationsResult> {
  return api.get<NotificationsResult>("/notifications");
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return api.post<{ updated: number }>("/notifications/read-all");
}
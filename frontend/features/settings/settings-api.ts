import { api } from "@/lib/api/client";
import type { NotificationsResult, Settings, SessionUser } from "@/types/api-types";

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

export function updateProfile(data: {
  firstName?: string;
  lastName?: string;
  university?: string | null;
  department?: string | null;
  academicYear?: string | null;
  timezone?: string;
  profilePicture?: string | null;
}): Promise<SessionUser> {
  return api.patch<SessionUser>("/auth/me", data);
}

export function changePassword(data: { currentPassword: string; newPassword: string }): Promise<{ changed: boolean }> {
  return api.post<{ changed: boolean }>("/auth/me/change-password", data);
}
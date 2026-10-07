import { api } from "@/lib/api/client";
import type {
  AppNotification,
  NotificationGenerateResult,
  NotificationStatus,
  NotificationType,
  NotificationsResult,
} from "@/types/api-types";

export interface NotificationListParams {
  status?: NotificationStatus;
  type?: NotificationType;
  unread?: boolean;
  limit?: number;
  cursor?: string;
}

export function listNotifications(
  params: NotificationListParams = {},
): Promise<NotificationsResult> {
  const query = new URLSearchParams();
  const entries = params as Record<string, string | number | boolean | undefined>;
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return api.get<NotificationsResult>(qs ? `/notifications?${qs}` : "/notifications");
}

export function markNotificationRead(id: string): Promise<AppNotification> {
  return api.post<AppNotification>(`/notifications/${id}/read`);
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return api.post<{ updated: number }>("/notifications/read-all");
}

export function updateNotification(
  id: string,
  input: { status?: NotificationStatus },
): Promise<AppNotification> {
  return api.patch<AppNotification>(`/notifications/${id}`, input);
}

/**
 * Run the reminder sweep. The endpoint is idempotent, so calling it on app
 * load is safe: it only creates reminders that do not exist yet.
 */
export function generateNotifications(): Promise<NotificationGenerateResult> {
  return api.post<NotificationGenerateResult>("/notifications/generate");
}

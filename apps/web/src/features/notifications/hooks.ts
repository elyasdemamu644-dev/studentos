"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as api from "./notifications-api";

/** Cache keys shared by the bell and the notifications page. */
export const notificationsKeys = {
  all: ["notifications"] as const,
  list: (params: api.NotificationListParams) => ["notifications", "list", params] as const,
};

export function useNotifications(params: api.NotificationListParams = {}) {
  return useQuery({
    queryKey: notificationsKeys.list(params),
    queryFn: () => api.listNotifications(params),
  });
}

/** Unread badge count for the header bell. */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationsKeys.list({ unread: true, limit: 1 }),
    queryFn: () => api.listNotifications({ unread: true, limit: 1 }),
    select: (data) => data.unreadCount,
  });
}

function useInvalidateNotifications() {
  const qc = useQueryClient();
  return (silent = false) => {
    qc.invalidateQueries({ queryKey: notificationsKeys.all });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    if (!silent) qc.invalidateQueries({ queryKey: ["course-summary"] });
  };
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => invalidate(),
    onError: () => toast.error("Could not mark the notification as read"),
  });
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: (data) => {
      invalidate();
      toast.success(
        data.updated > 0 ? `Marked ${data.updated} as read` : "Nothing left to read",
      );
    },
    onError: () => toast.error("Could not update your notifications"),
  });
}

export function useUpdateNotification() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "READ" | "ARCHIVED" }) =>
      api.updateNotification(id, { status }),
    onSuccess: () => invalidate(),
    onError: () => toast.error("Could not update the notification"),
  });
}

/**
 * Sweep for new reminders. Runs once per session on app load; the endpoint is
 * idempotent so repeats create nothing.
 */
export function useGenerateNotifications() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: () => api.generateNotifications(),
    onSuccess: (result) => {
      if (result.created > 0) {
        invalidate(true);
        toast.success(
          `${result.created} new reminder${result.created === 1 ? "" : "s"}`,
        );
      }
    },
    // A failed sweep must never surface as an error to the user; the badge
    // simply keeps its previous value.
  });
}

export type { AppNotification } from "@/types/api-types";

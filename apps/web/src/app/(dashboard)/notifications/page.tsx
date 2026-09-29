"use client";

import { useState } from "react";
import { Archive, BellOff, Check, RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Button, LoadingButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useGenerateNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUpdateNotification,
} from "@/features/notifications/hooks";
import {
  applyNotificationFilter,
  NOTIFICATION_FILTERS,
  serverStatusForFilter,
  type NotificationFilter,
} from "@/features/notifications/notification-utils";
import type { AppNotification } from "@/types/api-types";
import { NOTIFICATION_TYPE_LABELS } from "@/lib/labels";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function NotificationsPage() {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [showArchived, setShowArchived] = useState(false);

  const status = serverStatusForFilter(filter);
  const notifications = useNotifications({ status, limit: 100 });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const updateNotification = useUpdateNotification();
  const generate = useGenerateNotifications();

  const all = notifications.data?.items ?? [];
  const items = applyNotificationFilter(all, filter, showArchived);
  const unreadCount = notifications.data?.unreadCount ?? 0;

  const archive = (notification: AppNotification) => {
    updateNotification.mutate({ id: notification.id, status: "ARCHIVED" });
  };

  return (
    <div>
      <PageHeader
        kicker="Inbox"
        title="Notifications"
        description="Reminders for upcoming exams, due and overdue tasks, and goal deadlines."
        actions={
          <>
            <LoadingButton
              variant="outline"
              size="sm"
              loading={generate.isPending}
              onClick={() => generate.mutate()}
            >
              <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden /> Check for reminders
            </LoadingButton>
            <LoadingButton
              size="sm"
              loading={markAllRead.isPending}
              disabled={unreadCount === 0}
              onClick={() => markAllRead.mutate()}
            >
              <Check className="mr-1.5 h-4 w-4" aria-hidden /> Mark all read
            </LoadingButton>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={filter} onValueChange={(v) => setFilter(v as NotificationFilter)}>
          <SelectTrigger aria-label="Filter notifications" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOTIFICATION_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 rounded border-input accent-primary"
          />
          Show archived
        </label>

        {unreadCount > 0 && <Badge className="ml-auto">{unreadCount} unread</Badge>}
      </div>

      {notifications.isPending ? (
        <ListSkeleton rows={4} />
      ) : notifications.isError ? (
        <ErrorState error={notifications.error} retry={() => notifications.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title={
            filter === "all" ? "No notifications" : `No ${filter.toLowerCase()} notifications`
          }
          description={
            filter === "all"
              ? "Reminders appear here when a task is due, an exam is coming up, or a goal deadline is close."
              : "Try a different filter."
          }
        />
      ) : (
        <ul className="space-y-2" aria-label="Notifications">
          {items.map((notification) => (
            <li
              key={notification.id}
              className={cn(
                "rounded-xl border bg-card p-4 shadow-card transition-colors",
                notification.status === "UNREAD"
                  ? "border-primary/40 bg-primary/[0.03]"
                  : "border-border",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        notification.status === "UNREAD" ? "bg-primary" : "bg-transparent",
                      )}
                      aria-hidden
                    />
                    <p
                      className={cn(
                        "text-sm",
                        notification.status === "UNREAD" && "font-semibold",
                      )}
                    >
                      {notification.title}
                    </p>
                    <Badge variant="muted">
                      {NOTIFICATION_TYPE_LABELS[notification.type] ?? notification.type}
                    </Badge>
                  </div>
                  <p className="mt-1 pl-4 text-sm text-muted-foreground">
                    {notification.message}
                  </p>
                  <p className="mt-1.5 pl-4 text-xs text-muted-foreground">
                    {relativeTime(notification.createdAt)}
                    {notification.status === "READ" && notification.readAt && (
                      <> · read {relativeTime(notification.readAt)}</>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {notification.status === "UNREAD" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markRead.mutate(notification.id)}
                    >
                      <Check className="mr-1 h-4 w-4" aria-hidden /> Mark read
                    </Button>
                  )}
                  {notification.status !== "ARCHIVED" && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Archive ${notification.title}`}
                      onClick={() => archive(notification)}
                    >
                      <Archive className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

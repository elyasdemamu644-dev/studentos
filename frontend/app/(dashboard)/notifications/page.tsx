"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Archive,
  Bell,
  BellOff,
  Check,
  Clock,
  GraduationCap,
  RefreshCw,
  Target,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Chip, type Tone } from "@/components/panel";
import { IconChip } from "@/components/ui/surface";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Button, LoadingButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FilterBar, SelectFilter, ToggleFilter } from "@/components/ui/filter-bar";
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
import type { AppNotification, NotificationType } from "@/types/api-types";
import { NOTIFICATION_TYPE_LABELS } from "@/lib/labels";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Icon + colour per notification kind, so urgency reads at a glance. */
const TYPE_META: Record<NotificationType, { icon: LucideIcon; tone: Tone }> = {
  OVERDUE_TASK: { icon: AlertTriangle, tone: "danger" },
  ASSIGNMENT_DUE: { icon: Clock, tone: "warning" },
  EXAM_REMINDER: { icon: GraduationCap, tone: "warning" },
  STUDY_REMINDER: { icon: Timer, tone: "primary" },
  STUDY_PLAN_REMINDER: { icon: Timer, tone: "primary" },
  GOAL_REMINDER: { icon: Target, tone: "success" },
  GENERAL: { icon: Bell, tone: "neutral" },
};

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
        chips={
          notifications.data ? (
            <>
              {unreadCount > 0 && (
                <Chip tone="primary" icon={Bell}>
                  {unreadCount} unread
                </Chip>
              )}
              <Chip tone="neutral">{items.length} shown</Chip>
            </>
          ) : undefined
        }
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

      <FilterBar className="items-start">
        <SelectFilter
          value={filter}
          onChange={(value) => setFilter(value as NotificationFilter)}
          label="Filter notifications"
          placeholder="All notifications"
          allowEmpty={false}
          options={NOTIFICATION_FILTERS}
          className="sm:w-44"
        />
        <ToggleFilter
          checked={showArchived}
          onChange={setShowArchived}
          label="Show archived"
        />
        {unreadCount > 0 && <Badge className="sm:ml-auto">{unreadCount} unread</Badge>}
      </FilterBar>

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
                    <IconChip
                      icon={TYPE_META[notification.type]?.icon ?? Bell}
                      tone={TYPE_META[notification.type]?.tone ?? "neutral"}
                      className="h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5"
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
                  <p className="mt-1 pl-1 text-sm text-muted-foreground">
                    {notification.message}
                  </p>
                  <p className="mt-1.5 flex items-center gap-1.5 pl-1 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        notification.status === "UNREAD" ? "bg-primary" : "bg-muted-foreground/40",
                      )}
                      aria-hidden
                    />
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

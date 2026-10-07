"use client";

import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "@/features/notifications/hooks";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Header bell with an unread badge. Shows the most recent reminders inline and
 * links through to the full notifications page.
 */
export function NotificationBell({ className }: { className?: string }) {
  const unread = useUnreadCount();
  const recent = useNotifications({ limit: 5 });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const count = unread.data ?? 0;
  const items = recent.data?.items ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative", className)}
          aria-label={
            count > 0 ? `Notifications, ${count} unread` : "Notifications, none unread"
          }
        >
          <Bell className="h-4 w-4" aria-hidden />
          {count > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-danger-foreground"
              aria-hidden
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <DropdownMenuLabel className="flex items-center justify-between px-3 py-2">
          <span>Notifications</span>
          {count > 0 && (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              className="inline-flex items-center gap-1 text-xs font-normal text-primary hover:underline"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden />
              Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            You are all caught up.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {items.map((notification) => (
              <li key={notification.id}>
                <DropdownMenuItem
                  onSelect={() => {
                    if (notification.status === "UNREAD") {
                      markRead.mutate(notification.id);
                    }
                  }}
                  className="flex-col items-start gap-0.5 rounded-none px-3 py-2.5"
                >
                  <span className="flex w-full items-start gap-2">
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        notification.status === "UNREAD" ? "bg-primary" : "bg-transparent",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm",
                          notification.status === "UNREAD" && "font-semibold",
                        )}
                      >
                        {notification.title}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
                        {notification.message}
                      </span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {relativeTime(notification.createdAt)}
                      </span>
                    </span>
                  </span>
                </DropdownMenuItem>
              </li>
            ))}
          </ul>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="justify-center text-sm text-primary">
          <Link href="/notifications">View all notifications</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { useState } from "react";
import { BellRing, Check, Eye, Palette, RotateCcw, UserRound } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Chip, Panel } from "@/components/panel";
import { ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/features/auth/auth-provider";
import { useTheme } from "@/lib/theme/theme-provider";
import { useMarkAllNotificationsRead, useNotifications, useSettings, useUpdateSettings } from "@/features/settings/hooks";
import { AiConnectionsPanel } from "@/features/ai-connections/connection-list";
import { ThemeSelector } from "@/components/theme/selector";
import { ThemeModeToggle } from "@/components/theme-toggle";
import { relativeTime } from "@/lib/format";
import type { Settings } from "@/types/api-types";

const PREFERENCE_KEYS: Array<{ key: string; label: string; description: string }> = [
  { key: "notifications.assignmentReminders", label: "Assignment reminders", description: "Get daily reminders about due assignments." },
  { key: "notifications.overdueAlerts", label: "Overdue alerts", description: "Show alerts when a task falls overdue." },
  { key: "notifications.studyReminders", label: "Study reminders", description: "Suggest focus sessions during free time." },
  { key: "dashboard.showCompletedTasks", label: "Show completed tasks on dashboard", description: "Include finished work in dashboard task lists." },
];

function prefValue(settings: Settings | undefined, key: string): boolean {
  return settings?.[key] === "true";
}

export default function SettingsPage() {
  const { user } = useAuth();
  const theme = useTheme();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const notifications = useNotifications();
  const markAllRead = useMarkAllNotificationsRead();

  const [pendingKeys, setPendingKeys] = useState<Record<string, boolean>>({});

  const togglePreference = (key: string, value: boolean) => {
    const next: Settings = { [key]: value ? "true" : "false" };
    setPendingKeys((prev) => ({ ...prev, [key]: true }));
    void updateSettings.mutateAsync(next).finally(() => {
      setPendingKeys((prev) => ({ ...prev, [key]: false }));
    });
  };

  const initials =
    `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`.toUpperCase() || "S";

  const notifItems = notifications.data?.items ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Preferences"
        title="Settings"
        description="Profile, appearance, AI connections, notifications and app preferences."
        chips={
          <>
            <Chip tone="neutral" icon={Palette}>
              {theme.mode} mode
            </Chip>
            {(notifications.data?.unreadCount ?? 0) > 0 && (
              <Chip tone="primary" icon={BellRing}>
                {notifications.data?.unreadCount} unread
              </Chip>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Profile" icon={UserRound} tone="neutral" collapsible={false}>
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="text-base">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-semibold">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>
        </Panel>

        <Panel
          title="Notifications"
          icon={BellRing}
          tone="primary"
          collapsible={false}
          actions={
            <Button
              variant="outline"
              size="sm"
              disabled={(notifications.data?.unreadCount ?? 0) === 0}
              onClick={() => void markAllRead.mutateAsync()}
            >
              <Eye className="mr-1.5 h-4 w-4" aria-hidden /> Mark all read
            </Button>
          }
        >
          {notifications.isPending ? (
            <ListSkeleton rows={3} />
          ) : notifications.isError ? (
            <ErrorState error={notifications.error} retry={() => notifications.refetch()} />
          ) : notifItems.length === 0 ? (
            <p className="rounded-lg border border-primary/25 bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
              {notifications.data?.unreadCount
                ? `${notifications.data.unreadCount} unread notifications`
                : "You're all caught up"}
            </p>
          ) : (
            <ul className="space-y-2">
              {notifItems.slice(0, 8).map((notification) => (
                <li key={notification.id} className="flex items-start justify-between gap-3 rounded-lg border border-primary/25 bg-muted/40 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {notification.title}
                      {notification.status === "UNREAD" && (
                        <Badge variant="warning" className="px-1.5 py-0 text-[10px]">New</Badge>
                      )}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{notification.message}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/70">{relativeTime(notification.createdAt)}</p>
                  </div>
                  {notification.status === "UNREAD" && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" role="img" />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Appearance"
        icon={Palette}
        tone="primary"
        collapsible={false}
        actions={
          <Button variant="ghost" size="sm" onClick={() => theme.reset()}>
            <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden /> Reset
          </Button>
        }
      >

        <div className="space-y-6">
          <div>
            <p className="mb-1 text-sm font-medium">Appearance</p>
            <p className="mb-2 text-xs text-muted-foreground">
              Light, dark or follow your system. This is independent of the theme below.
            </p>
            <ThemeModeToggle />
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">Theme</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Each theme changes the palette, typography, corner shape, density, depth and motion —
              not just the colours.
            </p>
            <ThemeSelector />
          </div>
        </div>
      </Panel>

      <AiConnectionsPanel />

      <Panel title="Preferences" icon={Check} tone="success" collapsible={false}>
        <p className="mb-4 text-sm text-muted-foreground">
          These settings are synced to your account across devices.
        </p>
        {settings.isPending ? (
          <ListSkeleton rows={3} />
        ) : settings.isError ? (
          <ErrorState error={settings.error} retry={() => settings.refetch()} />
        ) : (
          <ul className="divide-y divide-border">
            {PREFERENCE_KEYS.map((pref) => {
              const enabled = prefValue(settings.data, pref.key);
              return (
                <li key={pref.key} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{pref.label}</p>
                    <p className="text-xs text-muted-foreground">{pref.description}</p>
                  </div>
                  <Switch
                    checked={enabled}
                    disabled={pendingKeys[pref.key]}
                    onCheckedChange={(checked) => togglePreference(pref.key, checked)}
                    aria-label={pref.label}
                  />
                </li>
            );
          })}
          </ul>
        )}
      </Panel>

      <Separator className="mb-2" />
      <p className="text-xs text-muted-foreground">
        StudentOS · Data is stored securely and private to your account.
      </p>
    </div>
  );
}
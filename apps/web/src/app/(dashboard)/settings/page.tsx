"use client";

import { useState } from "react";
import { BellRing, Check, Eye, Palette, RotateCcw, UserRound } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/features/auth/auth-provider";
import { useTheme } from "@/lib/theme/theme-provider";
import { ACCENTS, THEME_PRESETS } from "@/lib/theme/themes";
import { useMarkAllNotificationsRead, useNotifications, useSettings, useUpdateSettings } from "@/features/settings/hooks";
import { AiConnectionsPanel } from "@/features/ai-connections/connection-list";
import { relativeTime } from "@/lib/format";
import type { Settings } from "@/types/api-types";
import { cn } from "@/lib/utils";

const MODES: Array<{ value: "light" | "dark" | "system"; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

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
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <UserRound className="h-4 w-4 text-primary" aria-hidden /> Profile
          </h2>
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
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <BellRing className="h-4 w-4 text-primary" aria-hidden /> Notifications
            </h2>
            <Button
              variant="outline"
              size="sm"
              disabled={(notifications.data?.unreadCount ?? 0) === 0}
              onClick={() => void markAllRead.mutateAsync()}
            >
              <Eye className="mr-1.5 h-4 w-4" aria-hidden /> Mark all read
            </Button>
          </div>
          {notifications.isPending ? (
            <ListSkeleton rows={3} />
          ) : notifications.isError ? (
            <ErrorState error={notifications.error} retry={() => notifications.refetch()} />
          ) : notifItems.length === 0 ? (
            <p className="rounded-lg bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
              {notifications.data?.unreadCount
                ? `${notifications.data.unreadCount} unread notifications`
                : "You're all caught up"}
            </p>
          ) : (
            <ul className="space-y-2">
              {notifItems.slice(0, 8).map((notification) => (
                <li key={notification.id} className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
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
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <Palette className="h-4 w-4 text-primary" aria-hidden /> Appearance
          </h2>
          <Button variant="ghost" size="sm" onClick={() => theme.reset()}>
            <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden /> Reset
          </Button>
        </div>

        <div className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium">Mode</p>
            <div className="flex w-fit rounded-lg border border-border bg-muted/40 p-0.5">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => theme.setMode(m.value)}
                  aria-pressed={theme.mode === m.value}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                    theme.mode === m.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Preset</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => theme.setPreset(preset.id)}
                  aria-pressed={theme.preset === preset.id}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    theme.preset === preset.id
                      ? "border-primary ring-2 ring-ring"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <span className="flex gap-1">
                    {preset.swatch.map((color) => (
                      <span key={color} className="h-4 w-4 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                    ))}
                  </span>
                  <span className="mt-2 block text-sm font-medium">{preset.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Accent</p>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENTS.map((accent) => (
                <button
                  key={accent.id}
                  type="button"
                  onClick={() => theme.setAccent(accent.id)}
                  aria-label={`${accent.name} accent`}
                  aria-pressed={theme.accent === accent.id}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-full border px-3 text-sm transition-colors",
                    theme.accent === accent.id
                      ? "border-primary font-medium"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ backgroundColor: `hsl(${accent.primary})` }}
                    aria-hidden
                  />
                  {accent.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <AiConnectionsPanel />

      <section className="rounded-xl border border-border bg-card p-5 shadow-card">
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <Check className="h-4 w-4 text-primary" aria-hidden /> Preferences
        </h2>
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
      </section>

      <Separator className="mb-2" />
      <p className="text-xs text-muted-foreground">
        StudentOS · Data is stored securely and private to your account.
      </p>
    </div>
  );
}
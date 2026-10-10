"use client";

import { useState } from "react";
import { BellRing, Check, Eye, Palette, RotateCcw, UserRound, Pencil, Lock } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Chip, Panel } from "@/components/panel";
import { ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/features/auth/auth-provider";
import { useTheme } from "@/lib/theme/theme-provider";
import { useMarkAllNotificationsRead, useNotifications, useSettings, useUpdateSettings, useUpdateProfile, useChangePassword, getCompanionPreference, setCompanionPreference } from "@/features/settings/hooks";
import { AiConnectionsPanel } from "@/features/ai-connections/connection-list";
import { ThemeSelector } from "@/components/theme/selector";
import { ThemeModeToggle } from "@/components/theme-toggle";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Settings } from "@/types/api-types";
import { WallECompact, EveCompact } from "@/components/domain/ai-companion";

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
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();

  const [pendingKeys, setPendingKeys] = useState<Record<string, boolean>>({});
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({
    firstName: user?.firstName ?? "",
    lastName: user?.lastName ?? "",
    university: user?.university ?? "",
    department: user?.department ?? "",
    academicYear: user?.academicYear ?? "",
    timezone: user?.timezone ?? "UTC",
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
  });

  const togglePreference = (key: string, value: boolean) => {
    const next: Settings = { [key]: value ? "true" : "false" };
    setPendingKeys((prev) => ({ ...prev, [key]: true }));
    void updateSettings.mutateAsync(next).finally(() => {
      setPendingKeys((prev) => ({ ...prev, [key]: false }));
    });
  };

  const initials = (() => {
    try {
      if (!user || typeof user !== 'object') return "S";
      const first = user.firstName?.[0] ?? "";
      const last = user.lastName?.[0] ?? "";
      return (first + last).toUpperCase() || "S";
    } catch {
      return "S";
    }
  })();

  const notifItems = notifications.data?.items ?? [];

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfile.mutateAsync(profileForm);
    setEditProfileOpen(false);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await changePassword.mutateAsync(passwordForm);
    setChangePasswordOpen(false);
    setPasswordForm({ currentPassword: "", newPassword: "" });
  };

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
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <Dialog open={editProfileOpen} onOpenChange={setEditProfileOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Edit Profile</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleProfileSubmit} className="space-y-4 px-4 pb-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="firstName">First name</Label>
                    <Input id="firstName" value={profileForm.firstName} onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last name</Label>
                    <Input id="lastName" value={profileForm.lastName} onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={user?.email ?? ""} disabled />
                  <p className="text-xs text-muted-foreground">Email cannot be changed here.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="university">University</Label>
                    <Input id="university" value={profileForm.university} onChange={(e) => setProfileForm({ ...profileForm, university: e.target.value })} placeholder="University name" />
                  </div>
                  <div>
                    <Label htmlFor="department">Department</Label>
                    <Input id="department" value={profileForm.department} onChange={(e) => setProfileForm({ ...profileForm, department: e.target.value })} placeholder="Department" />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="academicYear">Academic year</Label>
                    <Input id="academicYear" value={profileForm.academicYear} onChange={(e) => setProfileForm({ ...profileForm, academicYear: e.target.value })} placeholder="e.g. 2024-2025" />
                  </div>
                  <div>
                    <Label htmlFor="timezone">Timezone</Label>
                    <Input id="timezone" value={profileForm.timezone} onChange={(e) => setProfileForm({ ...profileForm, timezone: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setEditProfileOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={updateProfile.isPending}>{updateProfile.isPending ? "Saving…" : "Save changes"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Change Password</DialogTitle>
              </DialogHeader>
              <form onSubmit={handlePasswordSubmit} className="space-y-4 px-4 pb-4">
                <div>
                  <Label htmlFor="currentPassword">Current password</Label>
                  <Input id="currentPassword" type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} autoComplete="current-password" />
                </div>
                <div>
                  <Label htmlFor="newPassword">New password</Label>
                  <Input id="newPassword" type="password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} autoComplete="new-password" minLength={8} />
                  <p className="text-xs text-muted-foreground">Must be at least 8 characters.</p>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => { setChangePasswordOpen(false); setPasswordForm({ currentPassword: "", newPassword: "" }); }}>Cancel</Button>
                  <Button type="submit" disabled={changePassword.isPending}>{changePassword.isPending ? "Changing…" : "Change password"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <div className="mt-4 flex gap-2">
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => { setProfileForm({ firstName: user?.firstName ?? "", lastName: user?.lastName ?? "", university: user?.university ?? "", department: user?.department ?? "", academicYear: user?.academicYear ?? "", timezone: user?.timezone ?? "UTC" }); setEditProfileOpen(true); }}>
                <Pencil className="mr-1.5 h-4 w-4" aria-hidden /> Edit profile
              </Button>
            </DialogTrigger>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => { setPasswordForm({ currentPassword: "", newPassword: "" }); setChangePasswordOpen(true); }}>
                <Lock className="mr-1.5 h-4 w-4" aria-hidden /> Change password
              </Button>
            </DialogTrigger>
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

          <div>
            <p className="mb-1 text-sm font-medium">AI Companion</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Choose which character assists you in the Dashboard AI Box.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  const next = setCompanionPreference(settings.data ?? {}, "wall-e");
                  updateSettings.mutate(next);
                }}
                className={cn(
                  "relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all",
                  getCompanionPreference(settings.data ?? {}) === "wall-e"
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/30 hover:border-primary/30"
                )}
              >
                <div className="w-20 h-20">
                  <WallECompact />
                </div>
                <span className="text-sm font-medium">WALL·E</span>
                <span className="text-xs text-muted-foreground">Curious & helpful</span>
                {getCompanionPreference(settings.data ?? {}) === "wall-e" && (
                  <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = setCompanionPreference(settings.data ?? {}, "eve");
                  updateSettings.mutate(next);
                }}
                className={cn(
                  "relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all",
                  getCompanionPreference(settings.data ?? {}) === "eve"
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/30 hover:border-primary/30"
                )}
              >
                <div className="w-20 h-20">
                  <EveCompact />
                </div>
                <span className="text-sm font-medium">EVE</span>
                <span className="text-xs text-muted-foreground">Sleek & focused</span>
                {getCompanionPreference(settings.data ?? {}) === "eve" && (
                  <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
              </button>
            </div>
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
"use client";

/**
 * Persisted shell preferences: sidebar collapse, pinned nav destinations and
 * the recently visited list. Kept deliberately small and best-effort, matching
 * the theme/session storage helpers — a failed write must never break the
 * shell, and every read is guarded so SSR never touches `window`.
 */

const SIDEBAR_COLLAPSED_KEY = "studentos.ui.sidebar-collapsed";
const PINNED_NAV_KEY = "studentos.ui.pinned-nav";
const RECENT_NAV_KEY = "studentos.ui.recent-nav";

export const MAX_RECENT_NAV = 4;

function readString(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best-effort (private mode, quota); the shell simply forgets the pref.
  }
}

function readStringList(key: string): string[] {
  const raw = readString(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function loadSidebarCollapsed(): boolean {
  return readString(SIDEBAR_COLLAPSED_KEY) === "1";
}

export function persistSidebarCollapsed(collapsed: boolean): void {
  writeString(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
}

export function loadPinnedNav(): string[] {
  return readStringList(PINNED_NAV_KEY);
}

export function persistPinnedNav(hrefs: string[]): void {
  writeString(PINNED_NAV_KEY, JSON.stringify(hrefs));
}

export function loadRecentNav(): string[] {
  return readStringList(RECENT_NAV_KEY).slice(0, MAX_RECENT_NAV);
}

export function persistRecentNav(hrefs: string[]): void {
  writeString(RECENT_NAV_KEY, JSON.stringify(hrefs.slice(0, MAX_RECENT_NAV)));
}

/** Move `href` to the front of the recent list, de-duplicated and capped. */
export function pushRecentNav(href: string, current: string[]): string[] {
  const next = [href, ...current.filter((value) => value !== href)].slice(0, MAX_RECENT_NAV);
  persistRecentNav(next);
  return next;
}

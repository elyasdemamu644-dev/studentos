// ─────────────────────────────────────────────
// Theme configuration
// ─────────────────────────────────────────────
//
// StudentOS theming has two independent axes:
//
//   Appearance — light | dark | system. Whether the sun is up.
//   Theme      — default | paper | neon | aurora | focus. What the app
//                looks and feels like: palette, typography, geometry,
//                density, depth, navigation, motion and AI chrome.
//
// They are separate on purpose. "System dark" is not a theme, and a user who
// prefers Neon at night should not lose it by switching to Dark.
//
// Theme definitions live in ./themes and are compiled into CSS by ./css.ts,
// which the root layout renders on the server. There is therefore no
// flash-of-wrong-theme and no JS-computed colour anywhere in the app.
//
// This module owns only the *preferences* layer: which theme, which
// appearance, and how they persist.

import { DEFAULT_THEME_ID, THEMES, isThemeId } from "./definitions";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedMode = "light" | "dark";
export type ThemeId = string;

/** Appearance is stored apart from theme identity, on purpose. */
export const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.includes(value as ThemeMode);
}

export interface ThemePreferences {
  mode: ThemeMode;
  themeId: ThemeId;
}

/** Read-only metadata used by pickers. Colours are only a fallback for SSR. */
export interface ThemeSummary {
  id: ThemeId;
  name: string;
  description: string;
  character: string[];
}

export const THEME_SUMMARIES: ThemeSummary[] = THEMES.map(({ id, name, description, character }) => ({
  id,
  name,
  description,
  character,
}));

export const DEFAULT_THEME: ThemePreferences = {
  mode: "system",
  themeId: DEFAULT_THEME_ID,
};

// ── Persistence ───────────────────────────────────────────────
const STORAGE_APPEARANCE = "studentos.appearance";
const STORAGE_THEME = "studentos.theme.id";

/**
 * Previous builds stored an accent colour that overrode the theme's primary.
 * Accents fought each theme's identity (a "Violet" accent made Paper look
 * like Default), so they are gone. The legacy keys are read once so an
 * existing user's saved appearance and theme survive the upgrade, then left
 * alone.
 */
const LEGACY_STORAGE_MODE = "studentos.theme.mode";
const LEGACY_STORAGE_PRESET = "studentos.theme.preset";

/**
 * Old preset ids mapped onto the new identities. Chosen so the user lands on
 * the theme with the closest character rather than losing their choice:
 *   academic/ocean/forest → default (calm, familiar)
 *   sunset/sakura         → paper (warm, printed)
 *   midnight/cyber        → neon (dark, technical)
 *   aurora                → aurora (kept)
 */
const LEGACY_PRESET_MAP: Record<string, ThemeId> = {
  academic: "default",
  ocean: "default",
  forest: "default",
  sunset: "paper",
  sakura: "paper",
  midnight: "neon",
  cyber: "neon",
  aurora: "aurora",
};

export function migrateLegacyPreset(preset: string): ThemeId | null {
  return LEGACY_PRESET_MAP[preset] ?? null;
}

export function loadThemePreferences(): ThemePreferences {
  if (typeof window === "undefined") return DEFAULT_THEME;

  try {
    const stored = window.localStorage;

    const mode =
      stored.getItem(STORAGE_APPEARANCE) ?? stored.getItem(LEGACY_STORAGE_MODE) ?? DEFAULT_THEME.mode;
    const legacyPreset = stored.getItem(LEGACY_STORAGE_PRESET);
    const themeId =
      stored.getItem(STORAGE_THEME) ??
      (legacyPreset ? migrateLegacyPreset(legacyPreset) : null) ??
      DEFAULT_THEME.themeId;

    return {
      mode: isThemeMode(mode) ? mode : DEFAULT_THEME.mode,
      themeId: isThemeId(themeId) ? themeId : DEFAULT_THEME.themeId,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function persistTheme(preferences: ThemePreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_APPEARANCE, preferences.mode);
    window.localStorage.setItem(STORAGE_THEME, preferences.themeId);
  } catch {
    // Persistence is best-effort (e.g. private mode).
  }
}

/** Map a mode + system preference into a resolved "light" | "dark". */
export function resolveThemeMode(mode: ThemeMode, systemDark: boolean): ResolvedMode {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

/**
 * Apply preferences to the DOM. Pure function, no persistence.
 *
 * Only attributes and classes are written: appearance via the `dark` class
 * (which Tailwind's `dark:` variant and the generated `.dark` token block both
 * read) and identity via `data-theme`. No colour is ever set inline.
 */
export function applyThemeToDom(preferences: ThemePreferences, systemDark = false): void {
  if (typeof document === "undefined") return;

  const resolved = resolveThemeMode(preferences.mode, systemDark);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = preferences.themeId;
  root.dataset.appearance = preferences.mode;
}

/**
 * Inline script injected into <head> so the correct theme is applied before
 * first paint. Deliberately dependency-free: it only toggles attributes, and
 * all colour comes from the server-rendered stylesheet.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var stored = window.localStorage;
    var legacyMode = stored.getItem('${LEGACY_STORAGE_MODE}');
    var mode = stored.getItem('${STORAGE_APPEARANCE}') || legacyMode || '${DEFAULT_THEME.mode}';
    var legacyPreset = stored.getItem('${LEGACY_STORAGE_PRESET}');
    var id = stored.getItem('${STORAGE_THEME}') || ${JSON.stringify(LEGACY_PRESET_MAP)}[legacyPreset] || '${DEFAULT_THEME_ID}';
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var el = document.documentElement;
    el.classList.toggle('dark', dark);
    el.setAttribute('data-theme', id);
    el.setAttribute('data-appearance', mode);
  } catch (e) {}
})();
`;

export { buildThemeCss } from "./css";
export { THEME_IDS, THEMES, getTheme, isThemeId } from "./definitions";
export type { ThemeDefinition } from "./token-contract";
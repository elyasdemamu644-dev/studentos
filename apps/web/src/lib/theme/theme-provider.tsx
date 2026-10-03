"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getTheme, THEMES } from "./definitions";
import type { ThemeDefinition } from "./token-contract";
import {
  applyThemeToDom,
  DEFAULT_THEME,
  loadThemePreferences,
  persistTheme,
  resolveThemeMode,
  THEME_SUMMARIES,
  type ThemeId,
  type ThemeMode,
  type ThemePreferences,
  type ThemeSummary,
} from "./themes";

interface ThemeContextValue {
  preferences: ThemePreferences;
  /** Appearance preference, including "system". */
  mode: ThemeMode;
  /** Visual identity, independent of appearance. */
  themeId: ThemeId;
  /** "light" | "dark" after resolving "system". */
  resolvedMode: "light" | "dark";
  /** All available themes, in picker order. */
  themes: readonly ThemeSummary[];
  /** The currently selected theme definition, including full tokens. */
  theme: ThemeDefinition;
  setMode: (mode: ThemeMode) => void;
  setThemeId: (themeId: ThemeId) => void;
  reset: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<ThemePreferences>(DEFAULT_THEME);
  const [systemDark, setSystemDark] = useState(false);

  // Load persisted preferences once hydrated. Until this runs the server
  // bootstrap script has already applied the right attributes, so there is
  // nothing to correct visually.
  useEffect(() => {
    setPreferences(loadThemePreferences());
    setSystemDark(systemPrefersDark());
  }, []);

  // Keep <html> in sync whenever preferences change.
  useEffect(() => {
    applyThemeToDom(preferences, systemDark);
  }, [preferences, systemDark]);

  // Follow OS scheme changes: only affects the DOM while in "system" mode.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      if (preferences.mode === "system") setSystemDark(event.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preferences.mode]);

  const update = useCallback((patch: Partial<ThemePreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch };
      persistTheme(next);
      return next;
    });
  }, []);

  const setMode = useCallback((mode: ThemeMode) => update({ mode }), [update]);
  const setThemeId = useCallback((themeId: ThemeId) => update({ themeId }), [update]);

  const reset = useCallback(() => {
    persistTheme(DEFAULT_THEME);
    setPreferences(DEFAULT_THEME);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const theme: ThemeDefinition = getTheme(preferences.themeId) ?? THEMES[0];
    return {
      preferences,
      mode: preferences.mode,
      themeId: theme.id,
      resolvedMode: resolveThemeMode(preferences.mode, systemDark),
      themes: THEME_SUMMARIES,
      theme,
      setMode,
      setThemeId,
      reset,
    };
  }, [preferences, reset, setMode, setThemeId, systemDark]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
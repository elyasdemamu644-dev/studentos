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

import {
  applyThemeToDom,
  DEFAULT_THEME,
  loadThemePreferences,
  persistTheme,
  resolveThemeMode,
  type ThemeMode,
  type ThemePreset,
  type ThemePreferences,
} from "./themes";

interface ThemeContextValue {
  preferences: ThemePreferences;
  mode: ThemeMode;
  preset: ThemePreset;
  accent: string;
  /** "light" | "dark" after resolving "system". */
  resolvedMode: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  setPreset: (preset: ThemePreset) => void;
  setAccent: (accent: string) => void;
  reset: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<ThemePreferences>(DEFAULT_THEME);

  // Load persisted preferences once hydrated.
  useEffect(() => {
    const prefs = loadThemePreferences();
    setPreferences(prefs);
    applyThemeToDom(prefs, systemPrefersDark());
  }, []);

  // Keep the <html> in sync whenever preferences change.
  useEffect(() => {
    applyThemeToDom(preferences, systemPrefersDark());
  }, [preferences]);

  // Follow OS scheme changes when in "system" mode.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (preferences.mode === "system") {
        applyThemeToDom(preferences, media.matches);
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preferences]);

  const setMode = useCallback((mode: ThemeMode) => {
    setPreferences((prev) => {
      const next = { ...prev, mode };
      persistTheme(next);
      return next;
    });
  }, []);

  const setPreset = useCallback((preset: ThemePreset) => {
    setPreferences((prev) => {
      const next = { ...prev, preset };
      persistTheme(next);
      return next;
    });
  }, []);

  const setAccent = useCallback((accent: string) => {
    setPreferences((prev) => {
      const next = { ...prev, accent };
      persistTheme(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    persistTheme(DEFAULT_THEME);
    setPreferences(DEFAULT_THEME);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preferences,
      mode: preferences.mode,
      preset: preferences.preset,
      accent: preferences.accent,
      resolvedMode: resolveThemeMode(preferences.mode, systemPrefersDark()),
      setMode,
      setPreset,
      setAccent,
      reset,
    }),
    [preferences, setAccent, setMode, setPreset, reset],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
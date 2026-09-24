// ─────────────────────────────────────────────
// Theme configuration
// ─────────────────────────────────────────────
//
// StudentOS themes:
//  - Mode:  light | dark | system
//  - Preset: base visual identity (sets surface + palette tokens in CSS)
//  - Accent: overrides the primary colour (buttons, links, focus, progress)
//
// Presets are implemented as CSS (globals.css `[data-theme="..."]` blocks)
// so there is no flash of unstyled content and no JS-computed colours.
// Accents are small HSL packs applied as inline CSS custom properties so a
// user-chosen accent affects every token-aware component consistently.

export type ThemeMode = "light" | "dark" | "system";
export type ThemePreset =
  | "ocean"
  | "aurora"
  | "forest"
  | "sunset"
  | "sakura"
  | "midnight"
  | "cyber"
  | "academic";

export interface ThemePresetMeta {
  id: ThemePreset;
  name: string;
  /** Short description shown in the Settings appearance section. */
  description: string;
  /** Sample colours used in the picker swatches. */
  swatch: string[];
}

export interface AccentColor {
  id: string;
  name: string;
  /** HSL triplets with % units, e.g. "243 75% 59%". */
  primary: string;
  foreground: string;
  ring: string;
}

export const THEME_PRESETS: ThemePresetMeta[] = [
  {
    id: "academic",
    name: "Academic",
    description: "Balanced indigo for everyday studying.",
    swatch: ["#6366f1", "#0ea5e9", "#f59e0b", "#10b981"],
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Calm blues that keep focus flowing.",
    swatch: ["#0ea5e9", "#14b8a6", "#3b82f6", "#22c55e"],
  },
  {
    id: "aurora",
    name: "Aurora",
    description: "Teal and green hues for fresh energy.",
    swatch: ["#14b8a6", "#22c55e", "#f97316", "#a855f7"],
  },
  {
    id: "forest",
    name: "Forest",
    description: "Grounded greens for deep work.",
    swatch: ["#22c55e", "#f97316", "#10b981", "#ec4899"],
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm orange and rose, vibrant but calm.",
    swatch: ["#f97316", "#f43f5e", "#f59e0b", "#a855f7"],
  },
  {
    id: "sakura",
    name: "Sakura",
    description: "Soft pink with a gentle, optimistic mood.",
    swatch: ["#ec4899", "#a855f7", "#f59e0b", "#2dd4bf"],
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Deep indigo surfaces for night-time work.",
    swatch: ["#6366f1", "#3b82f6", "#ec4899", "#06b6d4"],
  },
  {
    id: "cyber",
    name: "Cyber",
    description: "Neon violet and cyan on near-black.",
    swatch: ["#a855f7", "#06b6d4", "#ec4899", "#22c55e"],
  },
];

export const ACCENTS: AccentColor[] = [
  { id: "violet", name: "Violet", primary: "243 75% 59%", foreground: "0 0% 100%", ring: "243 75% 59%" },
  { id: "indigo", name: "Indigo", primary: "226 70% 55%", foreground: "0 0% 100%", ring: "226 70% 55%" },
  { id: "blue", name: "Blue", primary: "199 89% 48%", foreground: "0 0% 100%", ring: "199 89% 48%" },
  { id: "cyan", name: "Cyan", primary: "189 94% 43%", foreground: "230 25% 12%", ring: "189 94% 43%" },
  { id: "teal", name: "Teal", primary: "173 80% 40%", foreground: "0 0% 100%", ring: "173 80% 40%" },
  { id: "emerald", name: "Emerald", primary: "160 84% 39%", foreground: "0 0% 100%", ring: "160 84% 39%" },
  { id: "green", name: "Green", primary: "142 71% 40%", foreground: "0 0% 100%", ring: "142 71% 40%" },
  { id: "sunset", name: "Sunset", primary: "24 95% 48%", foreground: "0 0% 100%", ring: "24 95% 48%" },
  { id: "rose", name: "Rose", primary: "330 81% 55%", foreground: "0 0% 100%", ring: "330 81% 55%" },
  { id: "crimson", name: "Crimson", primary: "347 90% 55%", foreground: "0 0% 100%", ring: "347 90% 55%" },
  { id: "compass", name: "Compass", primary: "0 72% 51%", foreground: "0 0% 100%", ring: "0 72% 51%" },
];

// Persisted keys
const STORAGE_MODE = "studentos.theme.mode";
const STORAGE_PRESET = "studentos.theme.preset";
const STORAGE_ACCENT = "studentos.theme.accent";

export interface ThemePreferences {
  mode: ThemeMode;
  preset: ThemePreset;
  accent: string;
}

export const DEFAULT_THEME: ThemePreferences = {
  mode: "system",
  preset: "academic",
  accent: "violet",
};

export function loadThemePreferences(): ThemePreferences {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const mode = (window.localStorage.getItem(STORAGE_MODE) as ThemeMode) ?? DEFAULT_THEME.mode;
    const preset = (window.localStorage.getItem(STORAGE_PRESET) as ThemePreset) ?? DEFAULT_THEME.preset;
    const accent = window.localStorage.getItem(STORAGE_ACCENT) ?? DEFAULT_THEME.accent;
    return {
      mode: THEME_MODES.includes(mode as ThemeMode) ? (mode as ThemeMode) : DEFAULT_THEME.mode,
      preset: THEME_PRESETS.some((p) => p.id === preset) ? (preset as ThemePreset) : DEFAULT_THEME.preset,
      accent: ACCENTS.some((a) => a.id === accent) ? accent : DEFAULT_THEME.accent,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];

export function persistTheme(p: ThemePreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_MODE, p.mode);
    window.localStorage.setItem(STORAGE_PRESET, p.preset);
    window.localStorage.setItem(STORAGE_ACCENT, p.accent);
  } catch {
    // Persistence is best-effort (e.g. private mode).
  }
}

/** Map a mode + system preference into a resolved "light" | "dark". */
export function resolveThemeMode(mode: ThemeMode, systemDark: boolean): "light" | "dark" {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

/** Apply theme preferences to the DOM. Pure function, no persistence. */
export function applyThemeToDom(p: ThemePreferences, systemDark = false): void {
  if (typeof document === "undefined") return;

  const resolved = resolveThemeMode(p.mode, systemDark);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.setAttribute("data-theme", p.preset);

  const accent = ACCENTS.find((a) => a.id === p.accent);
  if (accent) {
    document.documentElement.style.setProperty("--primary", accent.primary);
    document.documentElement.style.setProperty("--primary-foreground", accent.foreground);
    document.documentElement.style.setProperty("--ring", accent.ring);
  } else {
    document.documentElement.style.removeProperty("--primary");
    document.documentElement.style.removeProperty("--primary-foreground");
    document.documentElement.style.removeProperty("--ring");
  }
}

/**
 * Inline script injected into <head> so the correct theme is applied before
 * first paint (prevents dark-mode / preset flash). Kept as a string to avoid
 * depending on React hydration timing.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var mode = localStorage.getItem('${STORAGE_MODE}') || 'system';
    var preset = localStorage.getItem('${STORAGE_PRESET}') || 'academic';
    var accent = localStorage.getItem('${STORAGE_ACCENT}') || 'violet';
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var el = document.documentElement;
    el.classList.toggle('dark', dark);
    el.setAttribute('data-theme', preset);
    var accents = ${JSON.stringify(ACCENTS)} ;
    var a = accents.find(function (x) { return x.id === accent; });
    if (a) {
      el.style.setProperty('--primary', a.primary);
      el.style.setProperty('--primary-foreground', a.foreground);
      el.style.setProperty('--ring', a.ring);
    }
  } catch (e) {}
})();
`;
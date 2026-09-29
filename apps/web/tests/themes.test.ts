import { describe, expect, it } from "vitest";
import {
  ACCENTS,
  DEFAULT_THEME,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_PRESETS,
  applyThemeToDom,
  loadThemePreferences,
  persistTheme,
  resolveThemeMode,
} from "@/lib/theme/themes";

describe("theme presets and accents", () => {
  it("exposes a default academic/violet system theme", () => {
    expect(DEFAULT_THEME).toEqual({ mode: "system", preset: "academic", accent: "violet" });
  });

  it("ships the expected suite of presets", () => {
    expect(THEME_PRESETS).toHaveLength(8);
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(ids).toContain("academic");
    expect(ids).toContain("midnight");
  });

  it("lets the user choose violet accent", () => {
    expect(ACCENTS.some((a) => a.id === "violet")).toBe(true);
  });
});

describe("resolveThemeMode", () => {
  it("resolves explicit modes directly", () => {
    expect(resolveThemeMode("light", true)).toBe("light");
    expect(resolveThemeMode("dark", false)).toBe("dark");
  });

  it("follows the system preference in system mode", () => {
    expect(resolveThemeMode("system", false)).toBe("light");
    expect(resolveThemeMode("system", true)).toBe("dark");
  });
});

describe("persistTheme / loadThemePreferences", () => {
  it("round-trips persisted preferences", () => {
    persistTheme({ mode: "dark", preset: "midnight", accent: "cyan" });
    expect(loadThemePreferences()).toEqual({ mode: "dark", preset: "midnight", accent: "cyan" });
  });

  it("falls back to defaults when storage is empty", () => {
    window.localStorage.clear();
    expect(loadThemePreferences()).toEqual(DEFAULT_THEME);
  });
});

describe("applyThemeToDom", () => {
  it("applies preset, mode and accent to the document", () => {
    applyThemeToDom({ mode: "dark", preset: "forest", accent: "emerald" });
    const el = document.documentElement;
    expect(el.classList.contains("dark")).toBe(true);
    expect(el.getAttribute("data-theme")).toBe("forest");
    expect(el.style.getPropertyValue("--primary")).toBe(ACCENTS.find((a) => a.id === "emerald")?.primary ?? "");
  });

  it("clears accent variables for unknown accents", () => {
    const el = document.documentElement;
    applyThemeToDom({ mode: "light", preset: "ocean", accent: "definitely-not-real" });
    expect(el.style.getPropertyValue("--primary")).toBe("");
    expect(el.classList.contains("dark")).toBe(false);
  });
});

describe("THEME_BOOTSTRAP_SCRIPT", () => {
  it("bakes in the accent pack", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("studentos.theme.mode");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("prefers-color-scheme");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("data-theme");
  });
});
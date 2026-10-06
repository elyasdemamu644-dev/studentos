import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildPreviewCss, buildThemeCss } from "@/lib/theme/css";
import { THEMES, getTheme, isThemeId } from "@/lib/theme/definitions";
import {
  APPEARANCE_VALUE_KEYS,
  CHARACTER_KEYS,
  COLOR_KEYS,
  type ThemeDefinition,
} from "@/lib/theme/token-contract";
import {
  DEFAULT_THEME,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_IDS,
  THEME_MODES,
  THEME_SUMMARIES,
  applyThemeToDom,
  isThemeMode,
  loadThemePreferences,
  migrateLegacyPreset,
  persistTheme,
  resolveThemeMode,
} from "@/lib/theme/themes";
import { contrastRatio, meetsContrast, parseHsl } from "@/lib/theme/hsl";

const tokenNames = (css: string): string[] =>
  [...css.matchAll(/--([a-z0-9-]+):/g)].map((match) => match[1]);

describe("theme registry", () => {
  it("ships exactly the five intended identities", () => {
    expect(THEME_IDS).toEqual(["default", "paper", "neon", "aurora", "focus"]);
  });

  it("keeps ids stable, because a rename silently resets a saved theme", () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(THEME_IDS);
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
  });

  it("describes structural character, not just palette", () => {
    for (const theme of THEMES) {
      expect(theme.description.length).toBeGreaterThan(30);
      expect(theme.character.length).toBeGreaterThanOrEqual(2);
      // A description that only names colours describes a tint, not a theme.
      expect(theme.description).not.toMatch(/^[^.]*\b(colou?r|palette)s?\b[^.]*\.$/i);
    }
  });

  it("exposes summaries for the picker without leaking full tokens", () => {
    expect(THEME_SUMMARIES.map((summary) => summary.id)).toEqual(THEME_IDS);
    for (const summary of THEME_SUMMARIES) {
      expect(Object.keys(summary).sort()).toEqual(["character", "description", "id", "name"]);
    }
  });

  it("resolves known ids and rejects unknown ones", () => {
    expect(getTheme("paper")?.id).toBe("paper");
    expect(getTheme("academic")).toBeUndefined();
    expect(isThemeId("neon")).toBe(true);
    expect(isThemeId("ocean")).toBe(false);
  });
});

describe("token contract completeness", () => {
  it("gives every theme every colour token in both appearances", () => {
    for (const theme of THEMES) {
      for (const appearance of ["light", "dark"] as const) {
        for (const key of COLOR_KEYS) {
          const value = theme.colors[appearance][key];
          expect(value, `${theme.id}/${appearance} is missing --${key}`).toBeTruthy();
        }
        for (const key of APPEARANCE_VALUE_KEYS) {
          expect(
            theme.colors[appearance][key],
            `${theme.id}/${appearance} is missing --${key}`,
          ).toBeTruthy();
        }
      }
    }
  });

  it("gives every theme every character token", () => {
    for (const theme of THEMES) {
      for (const key of CHARACTER_KEYS) {
        expect(
          theme.characterTokens[key],
          `${theme.id} is missing --${key}`,
        ).toBeTruthy();
      }
    }
  });

  it("keeps colour tokens as bare HSL triplets so Tailwind alpha modifiers work", () => {
    for (const theme of THEMES) {
      for (const appearance of ["light", "dark"] as const) {
        for (const key of COLOR_KEYS) {
          expect(() => parseHsl(theme.colors[appearance][key]), `${theme.id} --${key}`).not.toThrow();
        }
      }
    }
  });
});

describe("themes are genuinely different products", () => {
  const characterValue = (theme: ThemeDefinition, key: keyof ThemeDefinition["characterTokens"]) =>
    theme.characterTokens[key];

  it("gives each theme its own base geometry", () => {
    const radii = THEMES.map((theme) => characterValue(theme, "radius"));
    expect(new Set(radii).size).toBe(THEMES.length);
  });

  it("reaches badges, navigation and the AI workspace separately from cards", () => {
    // A theme that only changes `--radius` still leaves pills, nav pills and the
    // chat bubble on the default shape. Each of these is a separate decision,
    // so at least the set as a whole must vary.
    const subGeometry = THEMES.map((theme) =>
      [
        characterValue(theme, "badge-radius"),
        characterValue(theme, "nav-radius"),
        characterValue(theme, "ai-radius"),
      ].join("|"),
    );
    expect(new Set(subGeometry).size).toBe(THEMES.length);

    // Not every theme should agree on whether badges are pills.
    const badgeRadii = new Set(THEMES.map((theme) => characterValue(theme, "badge-radius")));
    expect(badgeRadii.size).toBeGreaterThan(1);
  });

  it("gives each theme its own control density", () => {
    const heights = THEMES.map((theme) => characterValue(theme, "control-h"));
    expect(new Set(heights).size).toBe(THEMES.length);
  });

  it("gives each theme its own motion", () => {
    const durations = THEMES.map((theme) => characterValue(theme, "motion-base"));
    expect(new Set(durations).size).toBe(THEMES.length);
  });

  it("gives each theme its own depth", () => {
    const shadows = THEMES.map((theme) => characterValue(theme, "shadow-card"));
    expect(new Set(shadows).size).toBe(THEMES.length);
  });

  it("gives each theme its own typographic system", () => {
    // Faces alone are too few to keep five themes apart (a system has three
    // generic families), so the signature is the whole system: face, tracking,
    // weights and leading. A theme that differs only in colour shares a
    // signature, and that is what this catches.
    const signatures = THEMES.map((theme) =>
      [
        characterValue(theme, "font-display"),
        characterValue(theme, "tracking-display"),
        characterValue(theme, "tracking-heading"),
        characterValue(theme, "heading-weight"),
        characterValue(theme, "display-weight"),
        characterValue(theme, "body-leading"),
      ].join("|"),
    );
    expect(new Set(signatures).size).toBe(THEMES.length);

    // At least one theme must be serif or monospaced, or every theme is just
    // the same app in a different colour.
    const faces = THEMES.map((theme) => characterValue(theme, "font-display"));
    expect(faces.some((face) => /serif/i.test(face))).toBe(true);
    expect(faces.some((face) => /monospace/i.test(face))).toBe(true);
  });

  it("gives each theme its own content measure", () => {
    const widths = THEMES.map((theme) => characterValue(theme, "content-width"));
    expect(new Set(widths).size).toBe(THEMES.length);
  });

  it("varies shadow and surface treatment, not just colour", () => {
    expect(new Set(THEMES.map((t) => characterValue(t, "shadow-inset"))).size).toBeGreaterThanOrEqual(3);
    // Neon and Aurora paint a texture behind the app; the rest stay flat.
    const textured = THEMES.filter((t) => characterValue(t, "app-background-image") !== "none");
    expect(textured.map((t) => t.id)).toEqual(["neon", "aurora"]);
  });
});

describe("accessibility of generated palettes", () => {
  /**
   * Every text/surface pair a user actually reads. A theme that fails any of
   * these is a theme that fails WCAG AA, so this is asserted rather than
   * eyeballed — including the pairs that only differ per appearance.
   */
  const READ_PAIRS = [
    ["foreground", "background"],
    ["foreground", "card"],
    ["foreground", "popover"],
    ["primary-foreground", "primary"],
    ["secondary-foreground", "secondary"],
    ["accent-foreground", "accent"],
    ["muted-foreground", "muted"],
    ["muted-foreground", "background"],
    ["muted-foreground", "card"],
    ["sidebar-foreground", "sidebar"],
    ["sidebar-accent-foreground", "sidebar-accent"],
    ["success-foreground", "success"],
    ["warning-foreground", "warning"],
    ["danger-foreground", "danger"],
  ] as const;

  it.each(["light", "dark"] as const)("keeps text legible in %s mode", (appearance) => {
    for (const theme of THEMES) {
      for (const [fg, bg] of READ_PAIRS) {
        const ratio = contrastRatio(theme.colors[appearance][fg], theme.colors[appearance][bg]);
        expect(
          ratio,
          `${theme.id}/${appearance}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps chart series distinguishable from their surface", () => {
    for (const theme of THEMES) {
      for (const appearance of ["light", "dark"] as const) {
        for (const key of ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const) {
          const ratio = contrastRatio(
            theme.colors[appearance][key],
            theme.colors[appearance]["chart-surface"],
          );
          expect(
            ratio,
            `${theme.id}/${appearance}: ${key} on chart surface is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});

describe("buildThemeCss", () => {
  const css = buildThemeCss(THEMES);

  it("emits a root rule so the page is styled before any script runs", () => {
    expect(css.startsWith(":root {")).toBe(true);
  });

  it("emits the dark variant for every theme, composed with the dark class", () => {
    for (const id of THEME_IDS) {
      if (id === "default") continue;
      expect(css).toContain(`[data-theme="${id}"] {`);
      expect(css).toContain(`.dark[data-theme="${id}"] {`);
    }
    expect(css).toContain(".dark {");
  });

  it("derives the radius and control-padding scale instead of authoring it", () => {
    expect(tokenNames(css)).toEqual(expect.arrayContaining(["radius-sm", "radius-md", "radius-lg", "radius-xl"]));
    expect(tokenNames(css)).toEqual(expect.arrayContaining(["control-px-sm", "control-px-lg"]));
  });

  it("covers every contracted token in every rule", () => {
    const expected = [...COLOR_KEYS, ...APPEARANCE_VALUE_KEYS, ...CHARACTER_KEYS];
    for (const rule of css.split("\n")) {
      if (!rule.includes("{")) continue;
      const emitted = tokenNames(rule);
      for (const key of expected) {
        expect(emitted, `${key} missing from: ${rule.slice(0, 60)}`).toContain(key);
      }
    }
  });

  it("clamps the derived scale so a small base radius cannot go negative", () => {
    // Neon sits at a 1px base radius, so a plain `calc(--radius - 4px)` would
    // compute -3px. The browser clamps that silently, but the token itself must
    // never be a negative length.
    expect(css).toContain("--radius-sm: max(calc(var(--radius) - 4px), 0px)");
    expect(css).toContain("--radius-md: max(calc(var(--radius) - 2px), 0px)");
    expect(css).not.toMatch(/--radius-sm:\s*calc\(/);
    expect(css).not.toMatch(/--radius-md:\s*calc\(/);

    // How small a base radius may be is a design decision per theme — Neon wants
    // square geometry — so the invariant is not "every small radius equals some
    // fixed value". It is that every theme declares a real, non-negative base
    // radius and that the generated scale for that theme clamps rather than
    // inverting.
    for (const theme of THEMES) {
      const radiusPx = Number.parseFloat(theme.characterTokens.radius) * 16;
      expect(Number.isFinite(radiusPx), theme.id).toBe(true);
      expect(radiusPx, theme.id).toBeGreaterThanOrEqual(0);

      const themeCss = buildThemeCss([theme]);
      expect(themeCss, theme.id).toContain("--radius-sm: max(calc(var(--radius) - 4px), 0px)");
      expect(themeCss, theme.id).toContain("--radius-md: max(calc(var(--radius) - 2px), 0px)");
      expect(themeCss, theme.id).not.toMatch(/--radius-sm:\s*calc\(/);
    }
  });

  it("reaches the transition and skeleton defaults that bypassed the theme", () => {
    // `import.meta.url` is not a file URL under the jsdom environment, so read
    // the stylesheet relative to the workspace root Vitest runs from.
    const globals = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    // Tailwind bakes 150ms into every `transition-*` utility, so motion
    // personality would stop at the components that never name a duration.
    // The zero-specificity `:where()` rule is what keeps `--motion-fast` the
    // default without overriding an explicit `duration-*`.
    expect(globals).toContain(':where([class*="transition-"]):not([class*="duration-"])');
    expect(globals).toContain("transition-duration: var(--motion-fast)");

    // The skeleton loop is derived from the motion token rather than a literal.
    expect(globals).toMatch(/\.skeleton\s*\{[^}]*animation:\s*theme-pulse\s+calc\(var\(--motion-base\)/);
    expect(globals).not.toMatch(/\.skeleton\s*\{[^}]*animate-pulse/);
  });

  it("never emits an accent override", () => {
    // Accents are gone: they replaced the theme's own brand colour and broke
    // themes whose identity depends on it.
    expect(css).not.toContain("accent-pack");
    expect(buildThemeCss(THEMES)).not.toMatch(/--accent-pack/);
  });
});

describe("buildPreviewCss", () => {
  it("scopes the full token set so a preview renders the real theme", () => {
    const neon = getTheme("neon")!;
    const css = buildPreviewCss(neon);
    expect(css.startsWith(".theme-preview {")).toBe(true);
    // Asserted against the theme's own declaration rather than a hardcoded
    // literal, so the preview cannot drift away from the token it renders.
    expect(css).toContain(`--radius: ${neon.characterTokens.radius}`);
    expect(css).toContain("--motion-ease: steps(4, end)");
  });

  it("paints themed textures but leaves flat themes alone", () => {
    // A theme that declares a texture also has to actually apply it, otherwise
    // the picker shows a gradient that the app never renders.
    expect(buildPreviewCss(getTheme("aurora")!)).toContain("background-attachment:fixed");
    expect(buildPreviewCss(getTheme("neon")!)).toContain("background-attachment:fixed");
    expect(buildPreviewCss(getTheme("focus")!)).toContain("--shadow-card");
    // `--app-background-image: none` is still emitted as a token, but no
    // background-image property is set for a flat theme.
    expect(buildPreviewCss(getTheme("default")!)).not.toContain("background-attachment");
    expect(buildPreviewCss(getTheme("paper")!)).not.toContain("background-attachment");
  });

  it("can render the dark appearance of a light theme", () => {
    expect(buildPreviewCss(getTheme("paper")!, "dark")).not.toBe(
      buildPreviewCss(getTheme("paper")!, "light"),
    );
  });
});

describe("appearance and theme are independent axes", () => {
  it("defaults to system appearance on the default theme", () => {
    expect(DEFAULT_THEME).toEqual({ mode: "system", themeId: "default" });
  });

  it("offers three appearance modes", () => {
    expect(THEME_MODES).toEqual(["light", "dark", "system"]);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("sepia")).toBe(false);
  });

  it("resolves explicit modes and follows the system in system mode", () => {
    expect(resolveThemeMode("light", true)).toBe("light");
    expect(resolveThemeMode("dark", false)).toBe("dark");
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("system", false)).toBe("light");
  });

  it("stores appearance and theme identity separately", () => {
    persistTheme({ mode: "dark", themeId: "paper" });
    expect(window.localStorage.getItem("studentos.appearance")).toBe("dark");
    expect(window.localStorage.getItem("studentos.theme.id")).toBe("paper");
    expect(window.localStorage.getItem("studentos.theme.accent")).toBeNull();
  });

  it("round-trips preferences", () => {
    persistTheme({ mode: "light", themeId: "aurora" });
    expect(loadThemePreferences()).toEqual({ mode: "light", themeId: "aurora" });
  });

  it("falls back to defaults when storage is empty", () => {
    window.localStorage.clear();
    expect(loadThemePreferences()).toEqual(DEFAULT_THEME);
  });

  it("keeps a theme when only the appearance changes", () => {
    persistTheme({ mode: "dark", themeId: "focus" });
    const afterModeChange = { ...loadThemePreferences(), mode: "light" as const };
    persistTheme(afterModeChange);
    expect(loadThemePreferences().themeId).toBe("focus");
  });
});

describe("legacy preference migration", () => {
  it("maps every removed preset to a surviving theme", () => {
    for (const legacy of [
      "academic",
      "ocean",
      "forest",
      "sunset",
      "sakura",
      "midnight",
      "cyber",
      "aurora",
    ]) {
      expect(migrateLegacyPreset(legacy), legacy).not.toBeNull();
      expect(isThemeId(migrateLegacyPreset(legacy)), legacy).toBe(true);
    }
  });

  it("carries a legacy mode and preset forward on first load", () => {
    window.localStorage.clear();
    window.localStorage.setItem("studentos.theme.mode", "dark");
    window.localStorage.setItem("studentos.theme.preset", "cyber");
    expect(loadThemePreferences()).toEqual({ mode: "dark", themeId: "neon" });
  });

  it("prefers the new keys when both exist", () => {
    window.localStorage.clear();
    window.localStorage.setItem("studentos.theme.mode", "light");
    window.localStorage.setItem("studentos.theme.preset", "cyber");
    window.localStorage.setItem("studentos.appearance", "dark");
    window.localStorage.setItem("studentos.theme.id", "paper");
    expect(loadThemePreferences()).toEqual({ mode: "dark", themeId: "paper" });
  });

  it("falls back safely on a corrupt legacy preset", () => {
    window.localStorage.clear();
    window.localStorage.setItem("studentos.theme.preset", "nonsense");
    expect(loadThemePreferences()).toEqual(DEFAULT_THEME);
  });
});

describe("applyThemeToDom", () => {
  it("applies appearance and identity as attributes only", () => {
    applyThemeToDom({ mode: "dark", themeId: "neon" }, false);
    const el = document.documentElement;
    expect(el.classList.contains("dark")).toBe(true);
    expect(el.dataset.theme).toBe("neon");
    expect(el.dataset.appearance).toBe("dark");
  });

  it("never writes colour inline, so themes cannot desync from the stylesheet", () => {
    applyThemeToDom({ mode: "light", themeId: "aurora" });
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("");
  });

  it("follows the system preference while in system mode", () => {
    applyThemeToDom({ mode: "system", themeId: "default" }, true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyThemeToDom({ mode: "system", themeId: "default" }, false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("THEME_BOOTSTRAP_SCRIPT", () => {
  it("reads both new and legacy keys before first paint", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("studentos.appearance");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("studentos.theme.id");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("studentos.theme.mode");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("prefers-color-scheme");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("data-theme");
  });

  it("does not ship an accent pack", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).not.toContain("accent");
  });
});

describe("contrast helpers", () => {
  it("rejects a malformed triplet with a message that names the fix", () => {
    expect(() => parseHsl("#ff0000")).toThrow(/bare HSL triplets/);
  });

  it("reports real WCAG ratios", () => {
    expect(meetsContrast("0 0% 100%", "0 0% 0%", 21)).toBe(true);
    expect(meetsContrast("0 0% 100%", "0 0% 100%", 4.5)).toBe(false);
  });
});
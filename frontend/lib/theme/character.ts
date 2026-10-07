import type { ThemeCharacter } from "./token-contract";

export const SANS_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const SERIF_STACK =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, "Times New Roman", serif';
export const MONO_STACK =
  'ui-monospace, "Cascadia Mono", "JetBrains Mono", Consolas, "Liberation Mono", monospace';

/**
 * The neutral character every theme starts from: a balanced, medium-round,
 * softly elevated, normally-paced productivity surface.
 *
 * Themes override only the axes they actually change. Keeping the baseline
 * explicit (rather than relying on whatever happens to be in globals.css)
 * means the contract is the source of truth and adding a token is a
 * deliberate, reviewable change rather than an invisible one.
 */
const BASE_CHARACTER: ThemeCharacter = {
  /* Typography personality */
  "font-sans": SANS_STACK,
  "font-display": "var(--font-sans)",
  "font-mono": MONO_STACK,
  "tracking-display": "-0.02em",
  "tracking-heading": "-0.01em",
  "heading-weight": "600",
  "display-weight": "700",
  "body-leading": "1.55",

  /* Geometry */
  radius: "0.8rem",
  "nav-radius": "calc(var(--radius-md))",
  // The neutral theme's badges are pills. Themes that reject the pill shape
  // override this rather than every badge component hard-coding `rounded-full`.
  "badge-radius": "9999px",
  "ai-radius": "var(--radius-lg)",

  /* Density: control geometry */
  "control-h": "2.25rem",
  "control-h-sm": "2rem",
  "control-h-lg": "2.5rem",
  "control-px": "1rem",
  "control-px-sm": "0.75rem",
  "control-px-lg": "1.5rem",

  /* Depth */
  "shadow-card": "0 1px 2px 0 rgb(15 23 42 / 0.05), 0 10px 28px -16px rgb(15 23 42 / 0.18)",
  "shadow-pop": "0 16px 40px -16px rgb(15 23 42 / 0.28)",
  "shadow-inset": "inset 0 1px 0 0 rgb(255 255 255 / 0.6)",
  "surface-blur": "0px",

  /* Motion */
  "motion-fast": "150ms",
  "motion-base": "250ms",
  "motion-ease": "cubic-bezier(0.32, 0.72, 0, 1)",
  "press-scale": "0.98",

  /* Chrome */
  "ring-width": "2px",
  "nav-indicator": "2px",
  "nav-inset": "0.5rem",
  

  /* Layout */
  "content-width": "72rem",
  "sidebar-width": "16rem",
  "page-pad": "1.5rem",

  /* AI workspace */
  "ai-font": "var(--font-sans)",
  "ai-glow": "0 0 0 0 hsl(var(--primary) / 0)",

  /* Texture / atmosphere */
  "app-background-image": "none",
};

export type CharacterOverrides = Partial<ThemeCharacter>;

/** Merge a theme's character overrides onto the shared baseline. */
export function character(overrides: CharacterOverrides): ThemeCharacter {
  return { ...BASE_CHARACTER, ...overrides };
}
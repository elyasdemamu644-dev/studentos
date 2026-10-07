/**
 * The token contract every visual theme must satisfy.
 *
 * A theme is not a palette. It is the whole visual language of the product:
 * colour, typography, geometry, density, depth, navigation, controls, motion,
 * overlays, data visualisation and AI workspace chrome. Defining the contract
 * in one place is what keeps the five themes from drifting into "the same app
 * with a different hue" — and it lets every component read tokens instead of
 * hard-coding its own values.
 *
 * Two kinds of token:
 *
 *  · PALETTE_KEYS are bare HSL triplets (`243 75% 59%`). Tailwind needs them
 *    in that form so `hsl(var(--primary) / <alpha-value>)` keeps working and
 *    `bg-primary/10` still compiles. They are consumed as `hsl(var(--token))`.
 *
 *  · CHARACTER_KEYS are plain CSS values (lengths, weights, shadows, easing,
 *    gradients). They are consumed verbatim.
 *
 * Note `--overlay` is the single deliberate exception to the "bare triplet"
 * rule: it carries its own alpha so a scrim can be a theme decision rather
 * than a hardcoded `bg-black/50`.
 */
export const PALETTE_KEYS = [
  /* Surfaces */
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "surface-raised",
  "surface-sunken",
  "surface-hover",
  /* Brand + states */
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "danger",
  "danger-foreground",
  /* Lines + focus */
  "border",
  "border-strong",
  "input",
  "ring",
  /* Navigation */
  "sidebar",
  "sidebar-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  /* Data visualisation */
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-grid",
  "chart-axis",
  "chart-surface",
  "chart-surface-border",
] as const;

/** Triplets that intentionally carry an alpha channel. */
export const ALPHA_PALETTE_KEYS = ["overlay"] as const;

/**
 * Appearance-dependent values that are not colours.
 *
 * Data-driven chips (course swatches) take their hue from the record, but how
 * strongly that hue is expressed depends on the appearance: a soft tint reads
 * as a wash on white and as mud on black. These are declared per appearance for
 * exactly that reason.
 */
export const APPEARANCE_VALUE_KEYS = [
  "chip-saturation",
  "chip-lightness",
  "chip-ring-lightness",
] as const;

/** Every colour token, including the alpha-carrying ones. */
export const COLOR_KEYS = [...PALETTE_KEYS, ...ALPHA_PALETTE_KEYS] as const;

export type AppearanceValueKey = (typeof APPEARANCE_VALUE_KEYS)[number];

/**
 * Character tokens. Authored per theme; `RADIUS_KEYS` and `CONTROL_PAD_KEYS`
 * are derived by the generator so a theme only states its base radius and
 * control padding instead of five near-identical numbers.
 */
export const CHARACTER_KEYS = [
  /* Typography personality */
  "font-sans",
  "font-display",
  "font-mono",
  "tracking-display",
  "tracking-heading",
  "heading-weight",
  "display-weight",
  "body-leading",
  /* Geometry */
  "radius",
  "nav-radius",
  "badge-radius",
  "ai-radius",
  /* Density: control geometry */
  "control-h",
  "control-h-sm",
  "control-h-lg",
  "control-px",
  "control-px-sm",
  "control-px-lg",
  /* Depth */
  "shadow-card",
  "shadow-pop",
  "shadow-inset",
  "surface-blur",
  /* Motion */
  "motion-fast",
  "motion-base",
  "motion-ease",
  "press-scale",
  /* Chrome */
  "ring-width",
  "nav-indicator",
  "nav-inset",
  /* Layout */
  "content-width",
  "sidebar-width",
  "page-pad",
  /* AI workspace */
  "ai-font",
  "ai-glow",
  /* Texture / atmosphere. `none` for flat themes. */
  "app-background-image",
] as const;

/** Derived by `buildThemeCss` from the theme's base radius. */
export const RADIUS_KEYS = ["radius-sm", "radius-md", "radius-lg", "radius-xl"] as const;

/** Authored per theme (listed here so the generator can derive nothing by accident). */
export const CONTROL_PAD_KEYS = ["control-px", "control-px-sm", "control-px-lg"] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type AlphaPaletteKey = (typeof ALPHA_PALETTE_KEYS)[number];
export type ColorKey = (typeof COLOR_KEYS)[number];
export type CharacterKey = (typeof CHARACTER_KEYS)[number];
export type TokenKey = ColorKey | CharacterKey | DerivedTokenKey;
export type DerivedTokenKey = (typeof RADIUS_KEYS)[number] | (typeof CONTROL_PAD_KEYS)[number];

export type Palette = Record<ColorKey, string> & Record<AppearanceValueKey, string>;

/**
 * What a theme authors. The generator fills in the derived radius and control
 * padding scale, so every theme is forced through the same derivation and
 * cannot end up with a hand-tuned inconsistency.
 */
export type ThemeCharacter = Record<CharacterKey, string>;

/** Everything required to render one theme in both appearances. */
export interface ThemeDefinition {
  id: string;
  name: string;
  /** One sentence naming the structural character, not just the colours. */
  description: string;
  /** Short labels for the axes this theme is built around. */
  character: string[];
  /** Character is appearance-independent: shape does not depend on the sun. */
  characterTokens: ThemeCharacter;
  colors: { light: Palette; dark: Palette };
}
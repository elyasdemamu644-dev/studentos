import { darken, legiblePair, lighten, mix, parseHsl, separatedFrom } from "./hsl";
import type { Palette } from "./token-contract";

/**
 * The handful of colours that actually decide how a theme reads. Everything
 * else — hairlines, muted fills, sidebar chrome, chart chrome, scrims — is
 * derived from these, which is what keeps five themes from becoming five
 * unreviewed colour systems.
 */
export interface PaletteSeed {
  /** Page background. */
  background: string;
  /** Body ink on `background`. */
  foreground: string;
  /** Raised surface (cards). */
  surface: string;
  /** Brand colour: buttons, links, active state, focus. */
  brand: string;
  /** Preferred ink on `brand`; overridden only if it would be illegible. */
  onBrand: string;
  /** Quiet fill: chips, inactive tabs, code blocks. */
  muted: string;
  /** Ink on `muted`. */
  mutedInk: string;
  border: string;
  /** Semantic status fills. Foregrounds are solved, not hand-written. */
  success: string;
  warning: string;
  danger: string;
  /** Five categorical series for charts, in a stable order. */
  series: [string, string, string, string, string];
  /** Navigation rail. Defaults to a tint of `background`. */
  sidebar?: string;
  /** Scrim behind modals and sheets. */
  overlay?: string;
}

/**
 * Builds a complete, contrast-solved palette from a theme's seed colours.
 *
 * Contrast is solved rather than declared because it is the one property that
 * depends on the interaction of many derived tokens: nudging a brand colour can
 * quietly push a button label to 3.7:1. `legiblePair` adjusts the *fill* (never
 * the ink) until the pair clears the bar, so a theme keeps its identity and
 * stays readable in both appearances.
 */
export function palette(seed: PaletteSeed): Palette {
  const { background, foreground, surface, border, muted, mutedInk, series } = seed;

  const isLight = parseHsl(background).l >= 50;
  const sidebar = seed.sidebar ?? mix(background, seed.brand, isLight ? 0.03 : 0.05);
  const overlay = seed.overlay ?? (isLight ? "220 30% 12% / 0.42" : "225 45% 3% / 0.66");

  /* ── Fills that carry text ─────────────────────────────────── */

  // The brand keeps the author's hue unless that hue cannot carry its label.
  const primaryPair = legiblePair(seed.brand, seed.onBrand, isLight ? foreground : "0 0% 100%");

  // Accent is a quiet hover/selection tint, so its ink is the theme's body ink.
  const accentPair = legiblePair(
    mix(surface, primaryPair.background, isLight ? 0.13 : 0.22),
    "0 0% 100%",
    foreground,
  );

  const sidebarAccentPair = legiblePair(
    mix(sidebar, primaryPair.background, isLight ? 0.16 : 0.24),
    "0 0% 100%",
    foreground,
  );

  const successPair = legiblePair(seed.success);
  const warningPair = legiblePair(seed.warning);
  const dangerPair = legiblePair(seed.danger);

  /* ── Chart series ──────────────────────────────────────────── */
  // Series are data rather than text, so the bar is the 3:1 non-text minimum
  // against the surface they are drawn on. Hue is load-bearing (the same five
  // series identify the same series across every chart), so only lightness moves.
  const chartSurface = surface;
  const charts = series.map((colour) => separatedFrom(colour, chartSurface, 3));

  return {
    background,
    foreground,

    card: surface,
    "card-foreground": foreground,
    popover: surface,
    "popover-foreground": foreground,

    "surface-raised": lighten(surface, isLight ? 0.025 : 0.035),
    "surface-sunken": darken(background, 0.02),
    "surface-hover": lighten(surface, isLight ? 0.03 : 0.04),

    primary: primaryPair.background,
    "primary-foreground": primaryPair.ink,
    secondary: muted,
    "secondary-foreground": mutedInk,
    muted,
    "muted-foreground": mutedInk,
    accent: accentPair.background,
    "accent-foreground": accentPair.ink,

    success: successPair.background,
    "success-foreground": successPair.ink,
    warning: warningPair.background,
    "warning-foreground": warningPair.ink,
    danger: dangerPair.background,
    "danger-foreground": dangerPair.ink,

    border,
    "border-strong": isLight ? darken(border, 0.03) : lighten(border, 0.05),
    input: isLight ? darken(border, 0.015) : lighten(border, 0.03),
    ring: primaryPair.background,

    sidebar,
    "sidebar-foreground": mutedInk,
    "sidebar-accent": sidebarAccentPair.background,
    "sidebar-accent-foreground": sidebarAccentPair.ink,
    "sidebar-border": isLight ? darken(border, 0.01) : lighten(border, 0.03),

    "chart-1": charts[0],
    "chart-2": charts[1],
    "chart-3": charts[2],
    "chart-4": charts[3],
    "chart-5": charts[4],
    // Chart chrome stays lower-contrast than the data itself.
    "chart-grid": mix(border, background, isLight ? 0.35 : 0.25),
    "chart-axis": mutedInk,
    "chart-surface": chartSurface,
    "chart-surface-border": border,

    overlay,

    // Data-driven chips: the hue comes from the record, the expression from
    // the theme and the appearance.
    "chip-saturation": isLight ? "62%" : "40%",
    "chip-lightness": isLight ? "91%" : "18%",
    "chip-ring-lightness": isLight ? "44%" : "62%",
  };
}
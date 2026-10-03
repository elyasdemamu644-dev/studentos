/**
 * Chart theming helpers.
 *
 * Recharts writes colours as SVG *attributes*, and ar() is not resolved in
 * presentation attributes — which is why the grid and axes used to be invisible.
 * Returning real CSS style objects (or class names) makes the custom
 * properties resolve, so charts follow the theme instead of hardcoding hexes.
 *
 * Nothing here knows about a specific theme; it only names the tokens.
 */

export const CHART_SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export const chartColor = (index: number): string =>
  CHART_SERIES[index % CHART_SERIES.length];

export const chartGridStyle = { stroke: "hsl(var(--chart-grid))" };

export const chartAxisStyle = { stroke: "hsl(var(--chart-axis))" };

export const chartAxisTick = { fontSize: 12, fill: "hsl(var(--chart-axis))" } as const;

/** Shared tooltip chrome, so every chart's tooltip looks the same. */
export const chartTooltipStyle = {
  borderRadius: "var(--radius-md)",
  border: "1px solid hsl(var(--chart-surface-border))",
  background: "hsl(var(--chart-surface))",
  color: "hsl(var(--foreground))",
  fontSize: "12px",
} as const;

/**
 * Bar corners follow the theme's radius rather than a fixed 4px.
 *
 * Recharts needs a *number* here, not a CSS value, so the resolved --radius-sm
 * is read off the document: whatever the active theme and appearance actually
 * compute to. --radius-sm is a clamped calc() of the theme radius, which the
 * browser resolves to an absolute px length, so both units are handled
 * defensively and the result is bounded to something that still reads as a bar.
 */
export function barRadius(): number {
  if (typeof window === "undefined") return 4;
  const raw = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue("--radius-sm")
    .trim();
  if (!raw) return 4;
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return 4;
  const px = raw.endsWith("rem") ? value * 16 : value;
  return Math.max(0, Math.min(12, px));
}

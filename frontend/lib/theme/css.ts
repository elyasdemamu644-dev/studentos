import type { ThemeDefinition } from "./token-contract";

/**
 * Turns theme definitions into the stylesheet the browser actually uses.
 *
 * Generating this instead of hand-maintaining `globals.css` matters for three
 * reasons:
 *
 *  1. The server renders it, so the correct tokens are in the first byte of
 *     HTML — no flash, no runtime cost, no dependence on hydration ordering.
 *  2. Adding a token to the contract forces every theme to supply it (via
 *     TypeScript) and produces the CSS for it (here), so nothing is forgotten.
 *  3. There is exactly one place where "token" becomes "CSS", so a rename can
 *     never silently orphan a theme.
 */

const declarations = (tokens: Record<string, string>): string =>
  Object.entries(tokens)
    .map(([key, value]) => `--${key}: ${value};`)
    .join(" ");

/**
 * Radius and control-padding scales are derived from each theme's base radius
 * and control padding. Deriving them here — rather than authoring five
 * near-identical numbers per theme — is what keeps a theme internally
 * consistent: change the base radius and the whole scale moves with it.
 *
 * `max(…, 0px)` matters: a theme may legitimately have a very small base radius
 * (Neon is 2px), and `calc(2px - 4px)` would compute a *negative* length. The
 * browser silently treats that as 0, but clamping here keeps the contract
 * honest and keeps `radius-sm` a real value a theme can reason about.
 */
const DERIVED_TOKENS: Record<string, string> = {
  "radius-sm": "max(calc(var(--radius) - 4px), 0px)",
  "radius-md": "max(calc(var(--radius) - 2px), 0px)",
  "radius-lg": "var(--radius)",
  "radius-xl": "calc(var(--radius) + 4px)",
  "control-px-sm": "max(calc(var(--control-px) - 4px), 0px)",
  "control-px-lg": "calc(var(--control-px) + 8px)",
};

const tokensFor = (theme: ThemeDefinition, appearance: "light" | "dark"): Record<string, string> => ({
  ...theme.colors[appearance],
  ...theme.characterTokens,
  ...DERIVED_TOKENS,
});

function block(selector: string, theme: ThemeDefinition, appearance: "light" | "dark"): string {
  return `${selector} { ${declarations(tokensFor(theme, appearance))} }`;
}

/**
 * The full stylesheet: one rule per theme per appearance.
 *
 * `:root` carries Default light so the page is styled even before the
 * bootstrap script runs; `.dark` carries Default dark so the `dark:`
 * Tailwind variant and the `dark` class always agree. Every other theme is
 * scoped to `data-theme`, and its dark variant additionally requires `.dark`
 * so appearance and identity compose instead of fighting each other.
 */
export function buildThemeCss(themes: ThemeDefinition[]): string {
  const [defaultTheme, ...rest] = themes;
  if (!defaultTheme) return "";

  return [
    block(":root", defaultTheme, "light"),
    block(".dark", defaultTheme, "dark"),
    ...rest.flatMap((theme) => [
      block(`[data-theme="${theme.id}"]`, theme, "light"),
      block(`.dark[data-theme="${theme.id}"]`, theme, "dark"),
    ]),
  ].join("\n");
}

/**
 * A self-contained stylesheet for theme previews. It redefines the token names
 * inside a scoped selector, so a preview renders the real theme — radius,
 * shadow, density, typography and all — rather than three coloured dots.
 */
export function buildPreviewCss(theme: ThemeDefinition, appearance: "light" | "dark" = "light"): string {
  const backgroundImage = theme.characterTokens["app-background-image"];
  const texture =
    backgroundImage === "none"
      ? ""
      : `background-image:${backgroundImage};background-attachment:fixed;`;
  return `.theme-preview { ${declarations(tokensFor(theme, appearance))} ${texture} }`;
}
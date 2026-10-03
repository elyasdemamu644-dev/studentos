import { defaultTheme } from "./default";
import { paperTheme } from "./paper";
import { neonTheme } from "./neon";
import { auroraTheme } from "./aurora";
import { focusTheme } from "./focus";
import type { ThemeDefinition } from "../token-contract";

/**
 * High-quality visual themes with genuinely distinct identities.
 * Each theme expresses different personality through typography, geometry,
 * density, depth, motion and atmosphere - not just colors.
 */
export const THEMES: ThemeDefinition[] = [
  defaultTheme,
  paperTheme,
  neonTheme,
  auroraTheme,
  focusTheme,
];

export const THEME_IDS = THEMES.map((theme) => theme.id);

export const DEFAULT_THEME_ID = defaultTheme.id;

export function getTheme(id: string): ThemeDefinition | undefined {
  return THEMES.find((theme) => theme.id === id);
}

export function isThemeId(id: unknown): id is string {
  return typeof id === "string" && THEME_IDS.includes(id);
};

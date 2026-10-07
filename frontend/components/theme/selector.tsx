"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { buildPreviewCss } from "@/lib/theme/css";
import { getTheme } from "@/lib/theme/definitions";
import type { ThemeDefinition } from "@/lib/theme/token-contract";
import { useTheme } from "@/lib/theme/theme-provider";

/**
 * A miniature of the app rendered in a theme's *own* tokens.
 *
 * The previous picker showed three coloured circles, which told a user nothing
 * about the things that actually differ between themes: corner radius, shadow,
 * control height, typeface, border weight. This preview scopes a generated copy
 * of the theme's tokens to a container, so what you see is what you get.
 */
function ThemePreview({
  theme,
  appearance,
  className,
}: {
  theme: ThemeDefinition;
  appearance: "light" | "dark";
  className?: string;
}) {
  return (
    <div className={cn("theme-preview relative overflow-hidden rounded-lg border", className)}>
      <style dangerouslySetInnerHTML={{ __html: buildPreviewCss(theme, appearance) }} />
      {/* Sidebar rail */}
      <div className="flex h-full">
        <div
          className="flex w-[26%] flex-col gap-1.5 border-r p-2"
          style={{
            backgroundColor: "hsl(var(--sidebar))",
            borderColor: "hsl(var(--sidebar-border))",
          }}
        >
          <span
            className="mb-1 block h-2 w-2/3 rounded-sm"
            style={{ backgroundColor: "hsl(var(--foreground) / 0.75)" }}
          />
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="block h-1.5 rounded-sm"
              style={{
                backgroundColor:
                  i === 0 ? "hsl(var(--sidebar-accent-foreground))" : "hsl(var(--sidebar-foreground) / 0.35)",
                width: i === 0 ? "100%" : `${88 - i * 8}%`,
              }}
            />
          ))}
        </div>
        {/* Content column: a control, a button and a card, all theme-sized */}
        <div className="flex flex-1 flex-col gap-1.5 p-2">
          <span
            className="block h-2 w-1/2 rounded-sm"
            style={{ backgroundColor: "hsl(var(--foreground) / 0.85)" }}
          />
          <div className="flex gap-1.5">
            <span
              className="inline-flex items-center justify-center px-2 text-[7px] font-medium"
              style={{
                height: "var(--control-h-sm)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
            >
              Save
            </span>
            <span
              className="inline-flex items-center justify-center px-2 text-[7px]"
              style={{
                height: "var(--control-h-sm)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Cancel
            </span>
          </div>
          <div
            className="flex-1 border p-1.5"
            style={{
              borderRadius: "var(--radius-md)",
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--card))",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <span
              className="block h-1 w-3/4 rounded-sm"
              style={{ backgroundColor: "hsl(var(--foreground) / 0.4)" }}
            />
            <span
              className="mt-1 block h-1 w-1/2 rounded-sm"
              style={{ backgroundColor: "hsl(var(--foreground) / 0.22)" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Visual theme picker. Appearance (light/dark/system) is a separate control:
 * this one changes what the app *is*, not whether the sun is up.
 *
 * These are toggle buttons rather than a radio group: the options are laid out
 * as a multi-column grid of cards, so arrow-key radio navigation would move
 * focus somewhere the user cannot see. `aria-pressed` describes the behaviour
 * honestly, and the group is labelled so assistive tech announces what the set
 * of buttons is for.
 */
export function ThemeSelector({ className }: { className?: string }) {
  const { themeId, setThemeId, resolvedMode, themes } = useTheme();
  const appearance: "light" | "dark" = resolvedMode === "dark" ? "dark" : "light";

  return (
    <div
      role="group"
      aria-label="Visual theme"
      className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}
    >
      {themes.map((summary) => {
        const theme = getTheme(summary.id);
        if (!theme) return null;
        const selected = summary.id === themeId;

        return (
          <button
            key={summary.id}
            type="button"
            aria-pressed={selected}
            onClick={() => setThemeId(summary.id)}
            className={cn(
              "group flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "border-primary ring-2 ring-ring"
                : "border-border hover:border-primary/40 hover:bg-surface-hover",
            )}
          >
            <ThemePreview
              theme={theme}
              appearance={appearance}
              className="h-20 w-full"
            />
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                {summary.name}
              </span>
              {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
            </span>
            <span className="text-xs text-muted-foreground">{summary.description}</span>
            <span className="flex flex-wrap gap-1">
              {summary.character.map((trait) => (
                <span
                  key={trait}
                  className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {trait}
                </span>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export { ThemePreview };
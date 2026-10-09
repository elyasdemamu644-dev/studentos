"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getTheme } from "@/lib/theme/definitions";
import type { ThemeMode } from "@/lib/theme/themes";
import { useTheme } from "@/lib/theme/theme-provider";

const MODES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * One control for both appearance axes: light/dark/system plus the visual
 * theme, with a real colour swatch per theme instead of a name alone. The
 * swatches read the theme definition directly, so every option renders the
 * palette you actually get when you pick it.
 */
export function ThemeMenu({ className }: { className?: string }) {
  const { mode, setMode, resolvedMode, themeId, setThemeId, themes } = useTheme();

  const CurrentIcon = MODES.find((option) => option.value === mode)?.icon ?? Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative", className)}
          aria-label={`Appearance: ${mode}. Theme: ${themeId}`}
          title="Appearance and theme"
        >
          <CurrentIcon className="h-4 w-4" aria-hidden />
          <span
            className="absolute bottom-1 right-1 h-2 w-2 rounded-full ring-1 ring-background"
            style={{ backgroundColor: "hsl(var(--primary))" }}
            aria-hidden
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <div className="grid grid-cols-3 gap-1 px-1 pb-2" role="group" aria-label="Appearance mode">
          {MODES.map((option) => {
            const selected = option.value === mode;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setMode(option.value)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-[11px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <option.icon className="h-4 w-4" aria-hidden />
                {option.label}
              </button>
            );
          })}
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {themes.map((summary) => {
          const theme = getTheme(summary.id);
          const palette = theme?.colors[resolvedMode === "dark" ? "dark" : "light"];
          const selected = summary.id === themeId;
          return (
            <DropdownMenuItem
              key={summary.id}
              onSelect={() => setThemeId(summary.id)}
              className="gap-2.5"
            >
              <span className="flex shrink-0 -space-x-1" aria-hidden>
                {(["primary", "accent", "background"] as const).map((token) => (
                  <span
                    key={token}
                    className="h-4 w-4 rounded-full ring-1 ring-border"
                    style={{ backgroundColor: palette ? `hsl(${palette[token]})` : undefined }}
                  />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{summary.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {summary.character.slice(0, 2).join(" · ")}
                </span>
              </span>
              {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

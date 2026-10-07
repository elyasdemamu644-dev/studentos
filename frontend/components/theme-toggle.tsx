"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme/theme-provider";
import type { ThemeMode } from "@/lib/theme/themes";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";

const MODES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * Appearance control: light / dark / system.
 *
 * Deliberately knows nothing about visual themes. Theme choice lives in the
 * theme selector, so the two axes can be changed independently.
 */
export function ThemeModeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useTheme();

  if (compact) {
    // Cycles rather than flipping, so "system" is still reachable from the
    // chrome. Flipping between light and dark would strand a user who chose
    // to follow their OS with no way back to that choice.
    const nextMode = MODES[(MODES.findIndex((option) => option.value === mode) + 1) % MODES.length].value;
    const label = mode === "system" ? "Appearance: system" : `Appearance: ${mode}`;

    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setMode(nextMode)}
        aria-label={`${label}. Change appearance`}
        title={`${label}. Change appearance`}
      >
        {mode === "light" && <Sun className="h-4 w-4" aria-hidden />}
        {mode === "dark" && <Moon className="h-4 w-4" aria-hidden />}
        {mode === "system" && <Monitor className="h-4 w-4" aria-hidden />}
      </Button>
    );
  }

  return (
    <SegmentedControl
      label="Appearance"
      value={mode}
      onChange={(value) => setMode(value as ThemeMode)}
      options={MODES.map(({ value, label, icon: Icon }) => ({
        value,
        label,
        icon: <Icon className="h-3.5 w-3.5" aria-hidden />,
      }))}
      className="surface-panel border-0 bg-muted/50 p-0.5 shadow-none"
    />
  );
}
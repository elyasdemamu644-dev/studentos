"use client";

import { courseHue } from "@/features/courses/courses-api";
import { useTheme } from "@/lib/theme/theme-provider";

/**
 * Deterministic, theme-aware course colour chip. In light mode the fill is a
 * soft tint; in dark mode it inverts to a deep tint so the chip stays visible.
 */
export function CourseSwatch({
  id,
  className,
  ring = true,
}: {
  id: string;
  className?: string;
  ring?: boolean;
}) {
  const { resolvedMode } = useTheme();
  const hue = courseHue(id);
  const dark = resolvedMode === "dark";
  const soft = dark ? `hsl(${hue} 38% 17%)` : `hsl(${hue} 60% 92%)`;
  const solid = `hsl(${hue} ${dark ? 65 : 62}% ${dark ? 60 : 45}%)`;
  return (
    <span
      aria-hidden
      className={className}
      style={ring ? { backgroundColor: soft, boxShadow: `inset 0 0 0 2px ${solid}` } : { backgroundColor: soft }}
    />
  );
}
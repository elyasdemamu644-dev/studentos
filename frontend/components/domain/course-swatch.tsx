"use client";

import { courseHue } from "@/features/courses/courses-api";

/**
 * Deterministic, theme-aware course colour chip.
 *
 * The hue is derived from the course id so a course always looks the same, but
 * saturation and lightness come from the theme's chip tokens. That is what makes
 * a chip a soft wash on Paper's warm paper, a saturated band on Neon, and a
 * legible deep tint in dark mode — without any per-theme branch here.
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
  const hue = courseHue(id);

  return (
    <span
      aria-hidden
      className={className}
      style={
        ring
          ? {
              backgroundColor: `hsl(${hue} var(--chip-saturation) var(--chip-lightness))`,
              boxShadow: `inset 0 0 0 2px hsl(${hue} var(--chip-saturation) var(--chip-ring-lightness))`,
            }
          : {
              backgroundColor: `hsl(${hue} var(--chip-saturation) var(--chip-lightness))`,
            }
      }
    />
  );
}
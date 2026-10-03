"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

/**
 * A determinate progress bar.
 *
 * `label` is required: all five call sites previously rendered an unnamed
 * `role="progressbar"`. `value` is clamped to 0–100 so a mis-fed number can
 * never render a bar wider than its track.
 */
const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    /** Accessible name. Describes what is progressing, e.g. "Course tasks". */
    label: string;
    /** Read out after the label, e.g. "3 of 8 done". */
    valueText?: string;
    indicatorClassName?: string;
  }
>(({ className, value, label, valueText, indicatorClassName, ...props }, ref) => {
  const clamped = Math.min(100, Math.max(0, value ?? 0));
  return (
    <ProgressPrimitive.Root
      ref={ref}
      aria-label={label}
      aria-valuetext={valueText}
      value={clamped}
      className={cn("relative h-2 w-full overflow-hidden rounded-badge bg-primary/15", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn("h-full w-full flex-1 rounded-badge bg-primary transition-transform", indicatorClassName)}
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
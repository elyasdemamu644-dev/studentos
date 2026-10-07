"use client";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Rendered instead of the label — used for theme previews. */
  content?: React.ReactNode;
  /** Rendered before the label — used by the appearance switch. */
  icon?: React.ReactNode;
}

/**
 * A radio group styled as a segmented control.
 *
 * Several hand-rolled variants of this existed, with inconsistent semantics
 * (`aria-pressed` in some places, `role="radio"` in others). This is the one
 * implementation, using the radio semantics all of them actually meant.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
  optionClassName,
}: {
  /** Exposed as the accessible group name. */
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  className?: string;
  optionClassName?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "flex w-fit rounded-lg border border-border bg-muted/40 p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "h-[var(--control-h-sm)]",
              selected
                ? "bg-surface-raised text-foreground shadow-inset"
                : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              optionClassName,
            )}
          >
            {option.icon}
            {option.content ?? option.label}
          </button>
        );
      })}
    </div>
  );
}
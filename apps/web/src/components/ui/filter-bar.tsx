import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The toolbar every list page sits under its header.
 *
 * Seven pages each had their own `mb-5 flex flex-wrap items-center gap-3` row,
 * with three different gap values and two different search-field widths, so
 * switching between Tasks and Resources moved the controls. One container, one
 * rhythm, and it stays a single row until it genuinely has to wrap.
 */
export function FilterBar({
  children,
  className,
  onClear,
  clearLabel = "Clear filters",
}: {
  children?: React.ReactNode;
  className?: string;
  /** Renders the reset affordance only when a handler is given. */
  onClear?: () => void;
  clearLabel?: string;
}) {
  return (
    <div
      className={cn(
        "mb-5 flex flex-col gap-2.5 rounded-xl border border-border bg-card/60 p-2.5 shadow-inset sm:flex-row sm:flex-wrap sm:items-center",
        className,
      )}
    >
      {children}
      {onClear && (
        <Button variant="ghost" size="sm" onClick={onClear} className="shrink-0 sm:ml-auto">
          <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {clearLabel}
        </Button>
      )}
    </div>
  );
}

/**
 * A search input with the icon already positioned.
 *
 * Seven copies of the same `absolute left-3 … pl-9` wrapper existed; four of
 * them had dropped the `top-1/2 -translate-y-1/2` and so sat a pixel low.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const inputId = `search-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className={cn("relative min-w-0 flex-1 sm:max-w-xs", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={inputId}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pl-9 [&::-webkit-search-cancel-button]:appearance-none"
      />
    </div>
  );
}

/**
 * A filter select with a stable width, so two selects in the same bar line up.
 *
 * `allowEmpty` renders an explicit "All …" option mapped to `""`, which is what
 * the API query params expect — the same convention every list page already
 * used, now stated once.
 */
export function SelectFilter({
  value,
  onChange,
  label,
  placeholder,
  allLabel,
  options,
  className,
  allowEmpty = true,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  /** Label for the "no filter" option. Omit to disable the empty option. */
  allLabel?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  className?: string;
  allowEmpty?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn("w-full shrink-0 sm:w-40", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty && allLabel && <SelectItem value="">{allLabel}</SelectItem>}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Checkbox + label pair used for the boolean filters (e.g. "show archived"). */
export function ToggleFilter({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        checked && "text-foreground",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-input accent-primary"
      />
      {label}
    </label>
  );
}
import type { LucideIcon } from "lucide-react";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";

/**
 * "Nothing here yet" with an optional route to fix it.
 *
 * `headingLevel` exists because this component is rendered both directly under
 * a page `<h1>` and inside a section that already has an `<h2>` — hard-coding
 * `h3` skipped a heading level on several pages.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
  headingLevel = 3,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** Drops the tall dashed box for use inside an already-boxed panel. */
  compact?: boolean;
  headingLevel?: 2 | 3 | 4;
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 text-center",
        compact ? "py-8" : "py-14",
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            "mb-4 flex items-center justify-center rounded-full bg-primary/10 text-primary",
            compact ? "h-10 w-10" : "h-12 w-12",
          )}
        >
          <Icon className={compact ? "h-5 w-5" : "h-6 w-6"} aria-hidden />
        </div>
      )}
      <Heading className="text-base font-semibold">{title}</Heading>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="surface-panel flex items-center gap-4 p-4">
          <div className="skeleton h-9 w-9 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-1/3" />
            <div className="skeleton h-3 w-1/2 opacity-70" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Skeletons announce themselves. They used to be `aria-hidden` with no status,
 * so a screen-reader user could not tell "loading" from "empty".
 */
export function ListSkeleton({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="surface-panel flex items-center gap-4 p-4">
            <div className="skeleton h-9 w-9 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-1/3" />
              <div className="skeleton h-3 w-1/2 opacity-70" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GridSkeleton({ cards = 4, label = "Loading" }: { cards?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="surface-panel p-5">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton mt-4 h-8 w-16 opacity-70" />
            <div className="skeleton mt-3 h-3 w-3/4 opacity-50" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Panel-shaped skeleton for pages that render a grid of cards. */
export function PanelSkeleton({ label = "Loading", children }: { label?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden>{children}</div>
    </div>
  );
}

export { Toaster, SkeletonRows };
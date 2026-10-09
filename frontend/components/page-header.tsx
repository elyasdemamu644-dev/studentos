import type { ReactNode } from "react";

/**
 * The page title block.
 *
 * Two variants:
 *
 *  · **hero** (default) — a gradient surface panel with the kicker, title,
 *    description, optional status chips and actions. This is the header every
 *    app page uses so the whole product shares the dashboard's look.
 *  · **plain** — the bare text header, for pages that supply their own chrome
 *    (the AI workspace, dialogs, nested views).
 */
export function PageHeader({
  title,
  description,
  actions,
  kicker,
  chips,
  variant = "hero",
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  kicker?: string;
  /** Status pills rendered under the description — counts, alerts, filters. */
  chips?: ReactNode;
  variant?: "hero" | "plain";
}) {
  if (variant === "plain") {
    return (
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {kicker && (
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary">
              {kicker}
            </p>
          )}
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          {chips && <div className="mt-2 flex flex-wrap gap-2">{chips}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    );
  }

  return (
    <header
      className="surface-panel relative mb-5 overflow-hidden animate-fade-in"
      style={{
        backgroundImage:
          "linear-gradient(120deg, hsl(var(--primary) / 0.12), hsl(var(--accent) / 0.07) 45%, transparent 75%)",
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          {kicker && (
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">{kicker}</p>
          )}
          <h1 className={kicker ? "mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl" : "text-2xl font-bold tracking-tight sm:text-3xl"}>
            {title}
          </h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          {chips && <div className="mt-3 flex flex-wrap gap-2">{chips}</div>}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}

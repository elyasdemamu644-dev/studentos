import * as React from "react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ArrowRight, Maximize2, Minimize2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * The panel every page is built from.
 *
 * `rounded-xl border border-border bg-card p-5 shadow-card` was hand-rolled in
 * 20+ places and had already drifted (`p-5` in one sibling, `p-6` in the
 * next). One primitive, one padding scale.
 */
const Surface = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("surface-panel p-5", className)}
      {...props}
    />
  ),
);
Surface.displayName = "Surface";

const SURFACE_ICON_TONES = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-muted text-muted-foreground",
} as const;

/** Square icon chip used in section headers and stat cards. */
export function IconChip({
  icon: Icon,
  tone = "primary",
  className,
}: {
  icon: LucideIcon;
  tone?: keyof typeof SURFACE_ICON_TONES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
        SURFACE_ICON_TONES[tone],
        className,
      )}
      aria-hidden
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

/**
 * A `Surface` with a titled header and an optional "see everything" link.
 *
 * This is the unit the dashboard, course detail and the settings panels are
 * composed from, so every panel in the app shares one header rhythm.
 */
export function SectionCard({
  title,
  icon,
  href,
  linkLabel = "View all",
  children,
  className,
  bodyClassName,
  headerExtra,
}: {
  title: string;
  icon?: LucideIcon;
  /** Renders the header link as a real link when provided. */
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Rendered after the title, before the link (counts, filters, …). */
  headerExtra?: React.ReactNode;
}) {
  return (
    <section className={cn("surface-panel flex flex-col p-5", className)}>
      <div className="mb-4 flex items-center gap-2.5">
        {icon && <IconChip icon={icon} />}
        <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
        {headerExtra}
        {href && (
          <Button asChild variant="ghost" size="sm" className="-mr-1.5 shrink-0">
            <Link href={href}>
              {linkLabel}
              <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        )}
      </div>
      <div className={cn("min-w-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

export { Surface };

// ── Workspace panels ─────────────────────────

/**
 * The one collapse control a collapsible panel has, and its header's own.
 *
 * It is deliberately private: a panel is not allowed to grow a second toggle,
 * which is how the AI workspace ended up with four disclosure buttons for three
 * panels and two of them both claimed to control the StudentOS context.
 */
function PanelCollapseControl({
  collapsed,
  onCollapsedChange,
  label,
  controls,
}: {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** What the panel holds, e.g. "chat history". */
  label: string;
  /** Id of the body this control opens and closes. */
  controls?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onCollapsedChange(!collapsed)}
      aria-expanded={!collapsed}
      aria-controls={controls}
      aria-label={`${collapsed ? "Show" : "Hide"} ${label}`}
      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {collapsed ? (
        <Maximize2 className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Minimize2 className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
}

/**
 * One column of a multi-panel workspace — the AI assistant's three panes.
 *
 * The workspace was hand-rolling this shape three times over, and the copies
 * drifted: one panel had a border and two did not, the paddings were
 * `px-3`/`px-4`/`p-5`, and the collapse affordance had been reinvented as a
 * chrome button in the chat's toolbar as well as in the context panel's own
 * header. One box, one header, one control.
 *
 * Three decisions are load-bearing:
 *
 *  · **The header is always the first child.** It is not swapped out when the
 *    panel collapses, so a panel has no "restore" step that could re-insert its
 *    header anywhere but the top. Collapsing only changes what sits *under* the
 *    header; the header itself is structurally pinned to the top edge in every
 *    state, and the control that reopens the panel is always inside it.
 *  · **The box is not a scroll container.** `overflow-clip` rather than
 *    `overflow-hidden`, because `hidden` still *is* one — it just hides the
 *    scrollbar. A hidden-but-real scroll container can hold, inherit or be
 *    scrolled to a non-zero offset by the browser's own scroll anchoring or by
 *    focus restoration, which is how a restored panel ends up showing its
 *    bottom with its header scrolled out of view. `clip` creates no scroll
 *    container at all, so that failure mode does not exist. The legitimate
 *    internal scrollers are unaffected: they are descendants with their own
 *    `overflow-y-auto` and keep their own scroll position, which is exactly the
 *    split the layout wants.
 *  · **Collapsing leaves a rail, not nothing.** A column that animated to zero
 *    width took its own restore control with it, which is precisely why a
 *    second button had to be added somewhere else. At rail width the header
 *    survives, so the panel that owns the control is also the panel that can
 *    bring itself back — one authoritative state and control per collapsible
 *    panel.
 *
 * Passing no `onCollapsedChange` makes the panel permanent, which is what the
 * AI chat is: it has no control, no collapsed state and no rail, and only its
 * width behaviour is unchanged.
 */
export function WorkspacePanel({
  title,
  label,
  icon: Icon,
  collapsed = false,
  onCollapsedChange,
  expandedClassName = "flex-1",
  headerExtra,
  children,
  className,
  bodyClassName,
}: {
  /** Shown in the header, and written down the rail when collapsed. */
  title: string;
  /**
   * How the panel is named in its control's accessible name, e.g.
   * "chat history". Kept separate from `title` so the visible heading can be
   * sentence case while the control still reads as a sentence.
   */
  label: string;
  icon: LucideIcon;
  collapsed?: boolean;
  /** Omit to make the panel permanent — no control, no rail, never collapsed. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Tailwind width for the expanded column. Defaults to "take what is left". */
  expandedClassName?: string;
  /** Rendered in the header, immediately before the collapse control. */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const bodyId = React.useId();
  const collapsible = onCollapsedChange !== undefined;

  return (
    <section
      className={cn(
        "surface-panel flex min-h-0 min-w-0 shrink-0 flex-col overflow-clip transition-[width]",
        collapsed ? "w-12" : expandedClassName,
        className,
      )}
      data-collapsed={collapsed ? "true" : undefined}
    >
      {/* Always first, always at the top — collapsed or not. In the rail it
          carries only the control, so the thing that brings the panel back is
          the thing at the top of the box. */}
      <header
        className={cn(
          "flex h-11 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-1" : "gap-2 px-3",
        )}
      >
        {collapsed ? null : (
          <>
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <h2 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </h2>
            {headerExtra}
          </>
        )}
        {collapsible && (
          <PanelCollapseControl
            collapsed={collapsed}
            onCollapsedChange={onCollapsedChange!}
            label={label}
            controls={collapsed ? undefined : bodyId}
          />
        )}
      </header>

      {collapsed ? (
        /* The rail. The panel's name written vertically under the header —
           everything a student needs to identify it, and nothing that could
           overflow three rems of width. */
        <div className="flex min-h-0 flex-1 flex-col items-center px-1 py-2">
          <span
            aria-hidden
            className="min-h-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground [writing-mode:vertical-rl] rotate-180"
          >
            {title}
          </span>
        </div>
      ) : (
        <div id={bodyId} className={cn("min-h-0 min-w-0 flex-1", bodyClassName)}>
          {children}
        </div>
      )}
    </section>
  );
}
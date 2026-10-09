import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

/**
 * The two layout atoms every page is composed from.
 *
 * `Panel` is the section shell the dashboard was built around — icon chip,
 * title, optional "view all" link and an optional collapse control — lifted
 * out of the dashboard page so tasks, exams, settings and the rest share one
 * section rhythm instead of each reinventing a header.
 *
 * `Chip` is the outline pill used for counts, countdowns and alert states.
 * Tones are static class strings so Tailwind can see them.
 */

export type Tone = "primary" | "success" | "warning" | "danger" | "neutral";

const TONE_OUTLINE: Record<Tone, string> = {
  primary: "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15",
  success: "border-success/30 bg-success/10 text-success hover:bg-success/15",
  warning: "border-warning/30 bg-warning/10 text-warning hover:bg-warning/15",
  danger: "border-danger/30 bg-danger/10 text-danger hover:bg-danger/15",
  neutral: "border-border bg-muted/60 text-muted-foreground hover:bg-muted",
};

/** Outline pill used for alert chips, countdowns and inline status. */
export function Chip({
  tone = "neutral",
  icon: Icon,
  href,
  children,
  className,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  const classes = cn(
    "inline-flex items-center gap-1.5 rounded-badge border px-2.5 py-1 text-xs font-medium",
    TONE_OUTLINE[tone],
    className,
  );
  const body = (
    <>
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }
  return <span className={classes}>{body}</span>;
}

/**
 * The one panel header every page section uses: icon chip, title, optional
 * actions, optional "view all" link and an optional collapse control.
 * Mirrors `SectionCard`'s rhythm so every surface in the app agrees.
 *
 * Panels stretch to fill equal-height grid rows so a row of boxes lines up.
 * A collapsed panel opts out (`self-start`) so it hugs its header instead of
 * stretching into an empty box.
 */
export function Panel({
  title,
  icon,
  tone = "primary",
  href,
  linkLabel = "View all",
  actions,
  collapsible = true,
  defaultOpen = true,
  className,
  headerClassName,
  children,
}: {
  title: string;
  icon: LucideIcon;
  tone?: Tone;
  href?: string;
  linkLabel?: string;
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
  headerClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section
      className={cn(
        "surface-panel flex flex-col p-5",
        collapsible && !open && "self-start",
        className,
      )}
    >
      <div className={cn("mb-4 flex items-center gap-2.5", headerClassName)}>
        <IconChip icon={icon} tone={tone} />
        <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
        {actions}
        {href && (
          <Button asChild variant="ghost" size="sm" className="-mr-1.5 shrink-0">
            <Link href={href}>
              {linkLabel}
              <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        )}
        {collapsible && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")}
              aria-hidden
            />
          </button>
        )}
      </div>
      {(!collapsible || open) && (
        <div id={bodyId} className="min-w-0 flex-1">
          {children}
        </div>
      )}
    </section>
  );
}

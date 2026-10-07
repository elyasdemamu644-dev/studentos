import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Surface } from "@/components/ui/surface";

const TONES = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-muted text-muted-foreground",
} as const;

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "primary",
  action,
  href,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: keyof typeof TONES;
  action?: ReactNode;
  /** Makes the whole card a link. */
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", TONES[tone])} aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
        {action}
      </div>
      <p className="mt-4 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className={cn(
          "block surface-panel p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className,
        )}
      >
        {body}
      </a>
    );
  }

  return (
    <Surface className={className}>{body}</Surface>
  );
}
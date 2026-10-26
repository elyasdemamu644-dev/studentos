"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import type { BriefingSeverity } from "@/types/api-types";
import { useProactiveBriefing } from "./hooks";

/** Urgency order for the digest: urgent, warning, info. */
const SEVERITY_RANK: Record<BriefingSeverity, number> = {
  urgent: 0,
  warning: 1,
  info: 2,
};

/** How many items the strip shows before summarising the rest. */
const MAX_VISIBLE = 3;

const SEVERITY_CLASSES: Record<BriefingSeverity, string> = {
  urgent: "border-danger/40 bg-danger/10 text-danger hover:bg-danger/15",
  warning: "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15",
  info: "border-border bg-muted/50 text-foreground hover:bg-muted",
};

/**
 * The AI workspace's proactive briefing: a slim strip above the panels with
 * what needs the student right now. Read-only and deterministic — every chip
 * deep-links to the workspace that owns the item. Renders nothing while
 * loading, on error, or when there is nothing to say, so an empty digest
 * never costs the chat a row of height.
 */
export function ProactiveBriefingStrip() {
  const briefing = useProactiveBriefing();

  if (briefing.isPending || briefing.isError || !briefing.data) return null;

  const sorted = [...briefing.data.items].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  if (sorted.length === 0) return null;

  const visible = sorted.slice(0, MAX_VISIBLE);
  const more = sorted.length - visible.length;

  return (
    <div
      role="region"
      aria-label="Needs your attention"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-card/80 px-3 py-2"
    >
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Needs attention
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {visible.map((item) => (
          <Link
            key={item.id}
            href={item.link}
            className={`max-w-full truncate rounded-lg border px-2 py-0.5 text-xs transition-colors ${SEVERITY_CLASSES[item.severity]}`}
            title={`${item.title} — ${item.detail}`}
          >
            <span className="font-medium">{item.title}</span>
            <span className="opacity-75"> · {item.detail}</span>
          </Link>
        ))}
        {more > 0 && (
          <span className="text-xs text-muted-foreground">
            +{more} more
          </span>
        )}
      </span>
    </div>
  );
}

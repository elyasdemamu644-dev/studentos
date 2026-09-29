import { Check, Circle } from "lucide-react";
import { AlertCircle } from "lucide-react";
import type { TaskPriority, TaskStatus } from "@/types/api-types";
import { PRIORITY_LABELS } from "@/lib/labels";

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const map = {
    LOW: "bg-muted text-muted-foreground",
    MEDIUM: "bg-primary/10 text-primary",
    HIGH: "bg-warning/15 text-warning",
    URGENT: "bg-danger/15 text-danger",
  } as const;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${map[priority]}`}>
      <span aria-hidden>
        {priority === "URGENT" && <AlertCircle className="h-3 w-3" />}
        {priority === "HIGH" && <AlertCircle className="h-3 w-3" />}
        {(priority === "MEDIUM" || priority === "LOW") && <Circle className="h-2.5 w-2.5 fill-current" />}
      </span>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "COMPLETED") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-label="Completed">
        <Check className="h-3 w-3" aria-hidden />
      </span>
    );
  }
  if (status === "CANCELLED") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-muted-foreground/40 text-muted-foreground" aria-label="Cancelled">
        <span className="h-2 w-0.5 -rotate-45 bg-current" aria-hidden />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-border text-muted-foreground transition-colors group-hover:border-primary group-hover:text-primary" aria-hidden>
      <Circle className="h-2.5 w-2.5" />
    </span>
  );
}
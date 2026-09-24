import { CalendarClock, Target } from "lucide-react";
import type { Goal } from "@/features/api-types";
import { formatDate } from "@/lib/format";
import { Progress } from "@/components/ui/progress";

export function GoalCard({ goal }: { goal: Goal }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{goal.title}</p>
        <span className="text-sm font-semibold text-primary">{goal.progress}%</span>
      </div>
      {goal.description && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{goal.description}</p>
      )}
      <Progress className="mt-4" value={goal.progress} />
      <div className="mt-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Target className="h-3.5 w-3.5" aria-hidden />
          {goal.milestones?.length ? `${goal.milestones.length} milestone${goal.milestones.length !== 1 ? "s" : ""}` : "No milestones"}
        </span>
        {goal.deadline && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            {formatDate(goal.deadline)}
          </span>
        )}
      </div>
    </div>
  );
}
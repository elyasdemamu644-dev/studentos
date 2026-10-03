"use client";

import { useState } from "react";
import { CalendarClock, Check, Pencil, Plus, RotateCcw, Target, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { LoadingButton } from "@/components/ui/button";
import { DialogShell } from "@/features/tasks/task-form";
import type { Goal, GoalMilestone } from "@/types/api-types";
import { MILESTONE_STATUS_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import {
  useCreateMilestone,
  useDeleteGoal,
  useDeleteMilestone,
  useMilestones,
  useUpdateGoal,
  useUpdateMilestone,
} from "@/features/goals/hooks";
import { cn } from "@/lib/utils";

export function GoalCard({ goal, onEdit }: { goal: Goal; onEdit: (goal: Goal) => void }) {
  const milestones = useMilestones(goal.id);
  const updateGoal = useUpdateGoal();
  const updateMilestone = useUpdateMilestone(goal.id);
  const createMilestone = useCreateMilestone(goal.id);
  const deleteMilestone = useDeleteMilestone(goal.id);
  const deleteGoal = useDeleteGoal();

  const [milestoneDraft, setMilestoneDraft] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const items = [...(milestones.data?.length ? milestones.data : (goal.milestones ?? []))].sort(
    (a, b) => a.position - b.position,
  );
  const completedMilestones = items.filter((m) => m.status === "COMPLETED").length;

  const toggleMilestone = (milestone: GoalMilestone) => {
    void updateMilestone.mutateAsync({
      id: milestone.id,
      input: { status: milestone.status === "COMPLETED" ? "TODO" : "COMPLETED" },
    });
  };

  const addMilestone = () => {
    const title = milestoneDraft.trim();
    if (!title) return;
    void createMilestone.mutateAsync({ title, position: items.length }).then(() => setMilestoneDraft(""));
  };

  const setStatus = (status: "ACTIVE" | "COMPLETED" | "CANCELLED") => {
    void updateGoal.mutateAsync({
      id: goal.id,
      input: { status, progress: status === "COMPLETED" ? 100 : goal.progress },
    });
  };

  return (
    <div
      className={cn(
        "surface-panel p-5",
        goal.status === "COMPLETED" && "opacity-80",
        goal.status === "CANCELLED" && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{goal.title}</p>
          {goal.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{goal.description}</p>}
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">{goal.progress}%</span>
      </div>

      <Progress
        className="mt-4"
        label={`${goal.title} progress`}
        value={goal.progress}
        valueText={`${goal.progress}% · ${completedMilestones} of ${items.length} milestones done`}
      />

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Target className="h-3.5 w-3.5" aria-hidden />
          {completedMilestones}/{items.length} milestones
        </span>
        {goal.deadline && (
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            {formatDate(goal.deadline)}
          </span>
        )}
        <span className="capitalize">{goal.status.toLowerCase()}</span>
      </div>

      <ul className="mt-4 space-y-1.5" aria-label="Milestones">
        {items.map((milestone) => (
          <li key={milestone.id} className="group flex items-center gap-2">
            <button
              type="button"
              onClick={() => toggleMilestone(milestone)}
              aria-label={milestone.status === "COMPLETED" ? "Mark milestone as not done" : "Mark milestone as done"}
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                milestone.status === "COMPLETED"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/50 hover:border-primary",
              )}
            >
              {milestone.status === "COMPLETED" && <Check className="h-3 w-3" aria-hidden />}
            </button>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                milestone.status === "COMPLETED" && "text-muted-foreground line-through",
              )}
              title={milestone.title}
            >
              {milestone.title}
            </span>
            <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
              {MILESTONE_STATUS_LABELS[milestone.status]}
            </span>
            <button
              type="button"
              onClick={() => void deleteMilestone.mutateAsync(milestone.id)}
              aria-label={`Delete milestone ${milestone.title}`}
              className="shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-2">
        <Input
          value={milestoneDraft}
          onChange={(e) => setMilestoneDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addMilestone();
          }}
          placeholder="Add a milestone…"
          aria-label="New milestone title"
          className="h-8 text-sm"
        />
        <Button variant="secondary" size="icon-sm" onClick={addMilestone} disabled={!milestoneDraft.trim()} aria-label="Add milestone">
          <Plus className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-1">
          {goal.status === "ACTIVE" && (
            <Button variant="success" size="sm" onClick={() => setStatus("COMPLETED")}>
              <Check className="mr-1 h-3.5 w-3.5" aria-hidden /> Complete
            </Button>
          )}
          {goal.status === "COMPLETED" && (
            <Button variant="outline" size="sm" onClick={() => setStatus("ACTIVE")}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden /> Reopen
            </Button>
          )}
          {goal.status === "CANCELLED" && (
            <Button variant="outline" size="sm" onClick={() => setStatus("ACTIVE")}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden /> Reactivate
            </Button>
          )}
          {goal.status === "ACTIVE" && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setStatus("CANCELLED")}>
              Cancel
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => onEdit(goal)} aria-label="Edit goal">
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon-sm" className="text-danger hover:text-danger" onClick={() => setDeleteOpen(true)} aria-label="Delete goal">
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      <DialogShell
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete goal"
        description={`This deletes "${goal.title}" and all of its milestones. This cannot be undone.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <LoadingButton
            variant="destructive"
            loading={deleteGoal.isPending}
            onClick={() => void deleteGoal.mutateAsync(goal.id).then(() => setDeleteOpen(false))}
          >
            <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Delete goal
          </LoadingButton>
        </div>
      </DialogShell>
    </div>
  );
}
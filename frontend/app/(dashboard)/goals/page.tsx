"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Target } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState, GridSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { GoalCard } from "@/features/goals/goal-card";
import { GoalFormDialog } from "@/features/goals/goal-form";
import { useGoals } from "@/features/goals/hooks";
import type { Goal, GoalStatus } from "@/types/api-types";

type Filter = "ALL" | GoalStatus;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

export default function GoalsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filter, setFilter] = useState<Filter>("ALL");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | undefined>(undefined);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setEditing(undefined);
      setFormOpen(true);
      router.replace("/goals");
    }
  }, [searchParams, router]);

  const goals = useGoals({ status: filter === "ALL" ? undefined : filter, limit: 100 });

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  return (
    <div>
      <PageHeader
        kicker="Ambition"
        title="Goals"
        description="Track the milestones that move the needle."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New goal
          </Button>
        }
      />

      <div className="mb-5">
        <SegmentedControl<Filter>
          label="Goal status"
          value={filter}
          onChange={setFilter}
          options={FILTERS}
          className="max-w-full overflow-x-auto"
        />
      </div>

      {goals.isPending ? (
        <GridSkeleton cards={3} />
      ) : goals.isError ? (
        <ErrorState error={goals.error} retry={() => goals.refetch()} />
      ) : goals.data && goals.data.items.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {goals.data.items.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onEdit={(g) => {
                setEditing(g);
                setFormOpen(true);
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Target}
          title={filter === "ALL" ? "No goals yet" : `No ${filter.toLowerCase()} goals`}
          description="Set a goal, add milestones, and track your progress until it's done."
          action={
            filter === "ALL" && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New goal
              </Button>
            )
          }
        />
      )}

      <GoalFormDialog open={formOpen} onOpenChange={setFormOpen} goal={editing} />
    </div>
  );
}
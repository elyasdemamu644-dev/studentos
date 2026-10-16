import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Goal, GoalMilestone } from "@/types/api-types";

const updateGoal = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/features/goals/hooks", () => ({
  useMilestones: () => ({ data: undefined }),
  useUpdateGoal: () => ({ mutateAsync: updateGoal, isPending: false }),
  useUpdateMilestone: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateMilestone: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteMilestone: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteGoal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { GoalCard } from "@/features/goals/goal-card";

function milestone(id: string, status: GoalMilestone["status"], position: number): GoalMilestone {
  return {
    id,
    goalId: "goal-1",
    title: `Milestone ${position}`,
    status,
    position,
    completedAt: status === "COMPLETED" ? "2026-09-01T00:00:00.000Z" : null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const COMPLETED_GOAL: Goal = {
  id: "goal-1",
  title: "Finish thesis",
  description: null,
  deadline: null,
  status: "COMPLETED",
  progress: 100,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  milestones: [milestone("m1", "COMPLETED", 0), milestone("m2", "TODO", 1)],
};

describe("GoalCard reopen", () => {
  beforeEach(() => {
    updateGoal.mockReset();
  });

  it("recomputes progress from milestones instead of leaving the goal at 100%", async () => {
    const user = userEvent.setup();
    render(<GoalCard goal={COMPLETED_GOAL} onEdit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /reopen/i }));

    expect(updateGoal).toHaveBeenCalledWith({
      id: "goal-1",
      input: { status: "ACTIVE", progress: 50 },
    });
  });
});

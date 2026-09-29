import { api } from "@/lib/api/client";
import type { Goal, GoalMilestone, GoalStatus, MilestoneStatus, Page } from "@/types/api-types";

export interface GoalListParams {
  status?: GoalStatus;
  limit?: number;
  cursor?: string;
}

export function listGoals(params: GoalListParams = {}): Promise<Page<Goal>> {
  const query = new URLSearchParams();
  const entries = params as Record<string, string | number | undefined>;
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return api.get<Page<Goal>>(qs ? `/goals?${qs}` : "/goals");
}

export function getGoal(id: string): Promise<Goal> {
  return api.get<Goal>(`/goals/${id}`);
}

export interface CreateGoalInput {
  title: string;
  description?: string | null;
  deadline?: string | null;
  status?: GoalStatus;
}

export function createGoal(input: CreateGoalInput): Promise<Goal> {
  return api.post<Goal>("/goals", input);
}

export interface UpdateGoalInput {
  title?: string;
  description?: string | null;
  deadline?: string | null;
  status?: GoalStatus;
  progress?: number;
}

export function updateGoal(id: string, input: UpdateGoalInput): Promise<Goal> {
  return api.patch<Goal>(`/goals/${id}`, input);
}

export function deleteGoal(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/goals/${id}`);
}

// ── Milestones ────────────────────────────────────

export function listMilestones(goalId: string): Promise<GoalMilestone[]> {
  return api.get<GoalMilestone[]>(`/goals/${goalId}/milestones`);
}

export interface CreateMilestoneInput {
  title: string;
  status?: MilestoneStatus;
  position?: number;
}

export function createMilestone(goalId: string, input: CreateMilestoneInput): Promise<GoalMilestone> {
  return api.post<GoalMilestone>(`/goals/${goalId}/milestones`, input);
}

export interface UpdateMilestoneInput {
  title?: string;
  status?: MilestoneStatus;
  position?: number;
}

export function updateMilestone(goalId: string, milestoneId: string, input: UpdateMilestoneInput): Promise<GoalMilestone> {
  return api.patch<GoalMilestone>(`/goals/${goalId}/milestones/${milestoneId}`, input);
}

export function deleteMilestone(goalId: string, milestoneId: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/goals/${goalId}/milestones/${milestoneId}`);
}
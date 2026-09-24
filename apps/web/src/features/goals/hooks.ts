"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as api from "./goals-api";

export function useGoals(params: api.GoalListParams = {}) {
  return useQuery({
    queryKey: ["goals", params],
    queryFn: () => api.listGoals(params),
  });
}

export function useGoal(id: string | undefined) {
  return useQuery({
    queryKey: ["goals", id],
    queryFn: () => api.getGoal(id!),
    enabled: Boolean(id),
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateGoalInput) => api.createGoal(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      toast.success("Goal created");
    },
    onError: () => toast.error("Could not create the goal"),
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.UpdateGoalInput }) => api.updateGoal(id, input),
    onSuccess: (goal) => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      toast.success(goal.status === "COMPLETED" ? "Goal completed — well done!" : "Goal updated");
    },
    onError: () => toast.error("Could not update the goal"),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteGoal(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.removeQueries({ queryKey: ["goals", id] });
      toast.success("Goal deleted");
    },
    onError: () => toast.error("Could not delete the goal"),
  });
}

// ── Milestones ────────────────────────────────────

export function useMilestones(goalId: string | undefined) {
  return useQuery({
    queryKey: ["goals", goalId, "milestones"],
    queryFn: () => api.listMilestones(goalId!),
    enabled: Boolean(goalId),
  });
}

export function useCreateMilestone(goalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateMilestoneInput) => api.createMilestone(goalId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals", goalId, "milestones"] });
    },
    onError: () => toast.error("Could not add the milestone"),
  });
}

export function useUpdateMilestone(goalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.UpdateMilestoneInput }) =>
      api.updateMilestone(goalId, id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals", goalId, "milestones"] });
      qc.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: () => toast.error("Could not update the milestone"),
  });
}

export function useDeleteMilestone(goalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteMilestone(goalId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals", goalId, "milestones"] });
    },
    onError: () => toast.error("Could not delete the milestone"),
  });
}

export type { Goal } from "@/features/api-types";
export type { GoalMilestone } from "@/features/api-types";
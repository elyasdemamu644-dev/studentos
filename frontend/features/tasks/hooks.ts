"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Task } from "@/types/api-types";
import * as api from "./tasks-api";

export function useTasks(params: api.TaskListParams = {}) {
  return useQuery({
    queryKey: ["tasks", params],
    queryFn: () => api.listTasks(params),
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ["tasks", id],
    queryFn: () => api.getTask(id!),
    enabled: Boolean(id),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateTaskInput) => api.createTask(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Task created");
    },
    onError: () => toast.error("Could not create the task"),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.UpdateTaskInput }) => api.updateTask(id, input),
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Task updated");
      void task;
    },
    onError: () => toast.error("Could not update the task"),
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.completeTask(id),
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`"${task.title}" completed`);
    },
    onError: () => toast.error("Could not complete the task"),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.removeQueries({ queryKey: ["tasks", id] });
      toast.success("Task deleted");
    },
    onError: () => toast.error("Could not delete the task"),
  });
}

// ── Subtasks ──────────────────────────────────────

export function useSubtasks(taskId: string | undefined) {
  return useQuery({
    queryKey: ["tasks", taskId, "subtasks"],
    queryFn: () => api.listSubtasks(taskId!),
    enabled: Boolean(taskId),
  });
}

export function useCreateSubtask(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateSubtaskInput) => api.createSubtask(taskId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", taskId, "subtasks"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: () => toast.error("Could not add the subtask"),
  });
}

export function useUpdateSubtask(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.CreateSubtaskInput }) =>
      api.updateSubtask(taskId, id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", taskId, "subtasks"] });
    },
    onError: () => toast.error("Could not update the subtask"),
  });
}

export function useDeleteSubtask(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSubtask(taskId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", taskId, "subtasks"] });
    },
    onError: () => toast.error("Could not delete the subtask"),
  });
}

export type { Task };
export type { Subtask } from "@/types/api-types";
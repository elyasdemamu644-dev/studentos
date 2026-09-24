import { api } from "@/lib/api/client";
import type { Page, Subtask, Task, TaskPriority, TaskStatus, TaskType } from "@/features/api-types";

export type { Task } from "@/features/api-types";

export interface TaskListParams {
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType;
  courseId?: string;
  dueBefore?: string;
  dueAfter?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export function listTasks(params: TaskListParams = {}): Promise<Page<Task>> {
  const query = new URLSearchParams();
  const entries = params as Record<string, string | number | undefined>;
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return api.get<Page<Task>>(qs ? `/tasks?${qs}` : "/tasks");
}

export function getTask(id: string): Promise<Task> {
  return api.get<Task>(`/tasks/${id}`);
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  courseId?: string | null;
  type?: TaskType;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
}

export function createTask(input: CreateTaskInput): Promise<Task> {
  return api.post<Task>("/tasks", input);
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  courseId?: string | null;
  type?: TaskType;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  completedAt?: string | null;
}

export function updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
  return api.patch<Task>(`/tasks/${id}`, input);
}

export function completeTask(id: string): Promise<Task> {
  return api.post<Task>(`/tasks/${id}/complete`);
}

export function deleteTask(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/tasks/${id}`);
}

// ── Subtasks ──────────────────────────────────────

export function listSubtasks(taskId: string): Promise<Subtask[]> {
  return api.get<Subtask[]>(`/tasks/${taskId}/subtasks`);
}

export interface CreateSubtaskInput {
  title: string;
  status?: TaskStatus;
  position?: number;
}

export function createSubtask(taskId: string, input: CreateSubtaskInput): Promise<Subtask> {
  return api.post<Subtask>(`/tasks/${taskId}/subtasks`, input);
}

export function updateSubtask(taskId: string, subtaskId: string, input: CreateSubtaskInput): Promise<Subtask> {
  return api.patch<Subtask>(`/tasks/${taskId}/subtasks/${subtaskId}`, input);
}

export function deleteSubtask(taskId: string, subtaskId: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/tasks/${taskId}/subtasks/${subtaskId}`);
}
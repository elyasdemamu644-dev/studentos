import { api } from "@/lib/api/client";
import type { StudySession, StudySessionListResult } from "@/features/api-types";

export interface SessionListParams {
  courseId?: string;
  taskId?: string;
  range?: "today" | "week" | "month";
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export function listSessions(params: SessionListParams = {}): Promise<StudySessionListResult> {
  const query = new URLSearchParams();
  const entries = params as Record<string, string | number | undefined>;
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return api.get<StudySessionListResult>(qs ? `/study-sessions?${qs}` : "/study-sessions");
}

export function getSession(id: string): Promise<StudySession> {
  return api.get<StudySession>(`/study-sessions/${id}`);
}

export interface StartSessionInput {
  courseId?: string | null;
  taskId?: string | null;
  topic?: string | null;
  startedAt: string;
  endedAt?: string | null;
  durationMinutes?: number | null;
}

export function startSession(input: StartSessionInput): Promise<StudySession> {
  return api.post<StudySession>("/study-sessions", input);
}

export interface CompleteSessionInput {
  endedAt?: string | null;
  durationMinutes?: number | null;
  focusRating?: number | null;
}

export function completeSession(id: string, input: CompleteSessionInput): Promise<StudySession> {
  return api.post<StudySession>(`/study-sessions/${id}/complete`, input);
}

export function deleteSession(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/study-sessions/${id}`);
}
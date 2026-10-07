import { api } from "@/lib/api/client";
import type { GradeRecord, GradeType, Page } from "@/types/api-types";

export interface GradeListParams {
  courseId?: string;
  type?: GradeType;
  limit?: number;
  cursor?: string;
}

export function listGrades(params: GradeListParams = {}): Promise<Page<GradeRecord>> {
  const query = new URLSearchParams();
  const entries = params as Record<string, string | number | undefined>;
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return api.get<Page<GradeRecord>>(qs ? `/grades?${qs}` : "/grades");
}

export function getGrade(id: string): Promise<GradeRecord> {
  return api.get<GradeRecord>(`/grades/${id}`);
}

export interface CreateGradeInput {
  courseId?: string | null;
  title: string;
  score?: number | null;
  maxScore?: number | null;
  weight?: number | null;
  type?: GradeType;
  recordedAt?: string;
}

export function createGrade(input: CreateGradeInput): Promise<GradeRecord> {
  return api.post<GradeRecord>("/grades", input);
}

export interface UpdateGradeInput {
  title?: string;
  score?: number | null;
  maxScore?: number | null;
  weight?: number | null;
  type?: GradeType;
  recordedAt?: string;
}

export function updateGrade(id: string, input: UpdateGradeInput): Promise<GradeRecord> {
  return api.patch<GradeRecord>(`/grades/${id}`, input);
}

export function deleteGrade(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/grades/${id}`);
}
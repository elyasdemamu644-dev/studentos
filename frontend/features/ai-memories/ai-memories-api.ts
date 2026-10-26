import { api } from "@/lib/api/client";
import type {
  AiMemory,
  CreateMemoryInput,
  MemoryListParams,
  MemoryPage,
  UpdateMemoryInput,
} from "@/types/api-types";

/** The student's saved memories, newest first, optionally filtered by category. */
export function listMemories(params: MemoryListParams = {}): Promise<MemoryPage> {
  const query = new URLSearchParams();
  const entries = params as Record<string, string | number | undefined>;
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return api.get<MemoryPage>(qs ? `/ai/memories?${qs}` : "/ai/memories");
}

/**
 * Save a memory. The API answers 201 for a new row and 200 when an
 * equivalent one already existed (dedup) — both unwrap to the memory, so
 * callers refresh the list instead of distinguishing the two.
 */
export function createMemory(input: CreateMemoryInput): Promise<AiMemory> {
  return api.post<AiMemory>("/ai/memories", input);
}

export function updateMemory(id: string, input: UpdateMemoryInput): Promise<AiMemory> {
  return api.patch<AiMemory>(`/ai/memories/${id}`, input);
}

export function deleteMemory(id: string): Promise<{ deleted: true }> {
  return api.delete<{ deleted: true }>(`/ai/memories/${id}`);
}

/** Clear every saved memory for the current user. Returns how many went. */
export function clearAllMemories(): Promise<{ deleted: number }> {
  return api.delete<{ deleted: number }>("/ai/memories");
}

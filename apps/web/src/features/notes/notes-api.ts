import { api } from "@/lib/api/client";
import type { Note, Page } from "@/features/api-types";

export interface NoteListParams {
  courseId?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export function listNotes(params: NoteListParams = {}): Promise<Page<Note>> {
  const query = new URLSearchParams();
  const entries = params as Record<string, string | number | undefined>;
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return api.get<Page<Note>>(qs ? `/notes?${qs}` : "/notes");
}

export function getNote(id: string): Promise<Note> {
  return api.get<Note>(`/notes/${id}`);
}

export interface CreateNoteInput {
  title: string;
  content: string;
  courseId?: string | null;
}

export function createNote(input: CreateNoteInput): Promise<Note> {
  return api.post<Note>("/notes", input);
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  courseId?: string | null;
}

export function updateNote(id: string, input: UpdateNoteInput): Promise<Note> {
  return api.patch<Note>(`/notes/${id}`, input);
}

export function deleteNote(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/notes/${id}`);
}
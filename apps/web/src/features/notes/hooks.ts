"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as api from "./notes-api";

export function useNotes(params: api.NoteListParams = {}) {
  return useQuery({
    queryKey: ["notes", params],
    queryFn: () => api.listNotes(params),
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateNoteInput) => api.createNote(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      toast.success("Note created");
    },
    onError: () => toast.error("Could not create the note"),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.UpdateNoteInput }) => api.updateNote(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      toast.success("Note saved");
    },
    onError: () => toast.error("Could not save the note"),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteNote(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.removeQueries({ queryKey: ["notes", id] });
      toast.success("Note deleted");
    },
    onError: () => toast.error("Could not delete the note"),
  });
}

export type { Note } from "@/features/api-types";
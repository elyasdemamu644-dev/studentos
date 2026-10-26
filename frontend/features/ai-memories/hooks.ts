"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CreateMemoryInput, MemoryListParams, UpdateMemoryInput } from "@/types/api-types";
import * as api from "./ai-memories-api";

export const memoriesKey = ["ai", "memories"];

export function useMemories(params: MemoryListParams = {}) {
  return useQuery({
    queryKey: [...memoriesKey, params],
    queryFn: () => api.listMemories(params),
  });
}

export function useCreateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMemoryInput) => api.createMemory(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memoriesKey });
      toast.success("Memory saved");
    },
    onError: () => toast.error("Could not save the memory"),
  });
}

export function useUpdateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMemoryInput }) =>
      api.updateMemory(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memoriesKey });
      toast.success("Memory updated");
    },
    onError: () => toast.error("Could not update the memory"),
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteMemory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memoriesKey });
      toast.success("Memory deleted");
    },
    onError: () => toast.error("Could not delete the memory"),
  });
}

export function useClearAllMemories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearAllMemories(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memoriesKey });
      toast.success("All memories cleared");
    },
    onError: () => toast.error("Could not clear the memories"),
  });
}

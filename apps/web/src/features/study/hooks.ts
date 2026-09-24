"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { StudySession } from "@/features/api-types";
import * as api from "./study-api";

export function useSessions(params: api.SessionListParams = {}) {
  return useQuery({
    queryKey: ["study-sessions", params],
    queryFn: () => api.listSessions(params),
  });
}

export function useStartSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.StartSessionInput) => api.startSession(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["study-sessions"] });
    },
    onError: () => toast.error("Could not start the study session"),
  });
}

export function useCompleteSession(onSuccess?: (session: StudySession) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.CompleteSessionInput }) =>
      api.completeSession(id, input),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ["study-sessions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onSuccess?.(session);
    },
    onError: () => toast.error("Could not log the study session"),
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["study-sessions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Session removed");
    },
    onError: () => toast.error("Could not delete the session"),
  });
}
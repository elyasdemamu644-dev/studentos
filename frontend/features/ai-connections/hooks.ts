"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AiProviderName } from "@/types/api-types";
import * as api from "./ai-connections-api";

const QUERY_KEY = ["ai-connections"];

export function useAiConnections(params: api.AiConnectionListParams = {}) {
  return useQuery({
    queryKey: [...QUERY_KEY, "list", params],
    queryFn: () => api.listConnections(params),
  });
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateConnectionInput) => api.createConnection(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("AI connection added");
    },
    onError: () => toast.error("Could not add the AI connection"),
  });
}

export function useUpdateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.UpdateConnectionInput }) =>
      api.updateConnection(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("AI connection updated");
    },
    onError: () => toast.error("Could not update the AI connection"),
  });
}

export function useActivateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.activateConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Connection activated");
    },
    onError: () => toast.error("Could not activate the connection"),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("AI connection removed");
    },
    onError: () => toast.error("Could not remove the AI connection"),
  });
}

export type TestConnectionVars =
  | { id: string }
  | { id?: undefined; input: api.CreateConnectionInput };

/**
 * Connectivity test. `{ id }` tests a saved connection (the API then reuses its
 * stored credentials); `{ input }` tests unsaved credentials. The result is
 * returned to the caller instead of being toasted, so the form can show it
 * inline.
 */
export function useTestConnection() {
  return useMutation({
    mutationFn: async (vars: TestConnectionVars) =>
      "id" in vars && vars.id
        ? api.testSavedConnection(vars.id)
        : api.testConnection((vars as { input: api.CreateConnectionInput }).input),
  });
}

export type { AiProviderName };

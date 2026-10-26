"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AiMode, ExecutionAutonomyMode } from "@/types/api-types";
import * as api from "./ai-connections-api";

const QUERY_KEY = ["ai-connections"];

export function useAiConnections(params: api.AiConnectionListParams = {}) {
  return useQuery({
    queryKey: [...QUERY_KEY, "list", params],
    queryFn: () => api.listConnections(params),
  });
}

export function useAiProviderSelection() {
  return useQuery({
    queryKey: ["ai-provider-selection"],
    queryFn: api.getProviderSelection,
  });
}

export function useSetAiProviderMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: api.AiProviderSelection["mode"]) => api.setProviderMode(mode),
    onSuccess: (settings) => {
      qc.setQueryData(["settings"], settings);
      qc.invalidateQueries({ queryKey: ["ai-provider-selection"] });
      toast.success("AI provider preference saved");
    },
    onError: () => toast.error("Could not change the AI provider"),
  });
}

/** The selectable Default AI models, from the static server catalog. */
export function useDefaultAiModels() {
  return useQuery({
    queryKey: ["ai-models"],
    queryFn: api.listDefaultAiModels,
    staleTime: 5 * 60 * 1000,
  });
}

/** Persist the assistant behaviour mode. `null` restores the AUTO default. */
export function useSetAiMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: AiMode | null) => api.setAiMode(mode),
    onSuccess: (settings) => {
      qc.setQueryData(["settings"], settings);
      qc.invalidateQueries({ queryKey: ["ai-provider-selection"] });
      toast.success("AI mode updated");
    },
    onError: () => toast.error("Could not change the AI mode"),
  });
}

/** Persist the Default AI model. `null` restores the server default. */
export function useSetDefaultModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (model: string | null) => api.setDefaultModel(model),
    onSuccess: (settings) => {
      qc.setQueryData(["settings"], settings);
      qc.invalidateQueries({ queryKey: ["ai-provider-selection"] });
      toast.success("Default AI model updated");
    },
    onError: () => toast.error("Could not change the model"),
  });
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateConnectionInput) => api.createConnection(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["ai-provider-selection"] });
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
      qc.invalidateQueries({ queryKey: ["ai-provider-selection"] });
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
      qc.invalidateQueries({ queryKey: ["ai-provider-selection"] });
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
      qc.invalidateQueries({ queryKey: ["ai-provider-selection"] });
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

/** Persist the assistant execution autonomy mode. `null` restores the manual default. */
export function useSetExecutionAutonomyMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: ExecutionAutonomyMode | null) => api.setExecutionAutonomyMode(mode),
    onSuccess: (settings) => {
      qc.setQueryData(["settings"], settings);
      qc.invalidateQueries({ queryKey: ["ai-provider-selection"] });
      toast.success("Execution autonomy mode updated");
    },
    onError: () => toast.error("Could not change the execution autonomy mode"),
  });
}

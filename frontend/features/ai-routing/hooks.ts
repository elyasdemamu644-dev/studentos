"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  AiCapabilityOverride,
  AiModelPreference,
  AiModelPreferenceInput,
  AiRoutingPolicyUpdate,
} from "@/types/api-types";
import * as api from "./ai-routing-api";

const ROUTING_KEY = ["ai-routing"];

export function useRoutingPolicy() {
  return useQuery({
    queryKey: [...ROUTING_KEY, "policy"],
    queryFn: api.getRoutingPolicy,
  });
}

export function useUpdateRoutingPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AiRoutingPolicyUpdate) => api.updateRoutingPolicy(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROUTING_KEY });
      toast.success("Routing settings saved");
    },
    onError: () => toast.error("Could not save the routing settings"),
  });
}

export function useRoutingCatalog() {
  return useQuery({
    queryKey: [...ROUTING_KEY, "catalog"],
    queryFn: api.getRoutingCatalog,
    staleTime: 5 * 60 * 1000,
  });
}

export function useGlobalPreferences() {
  return useQuery({
    queryKey: [...ROUTING_KEY, "preferences"],
    queryFn: api.listGlobalPreferences,
  });
}

export function useReplaceGlobalPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: AiModelPreferenceInput[]) =>
      api.replaceGlobalPreferences(preferences),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROUTING_KEY });
      toast.success("Model preferences saved");
    },
    onError: () => toast.error("Could not save the model preferences"),
  });
}

export function useCapabilityOverrides() {
  return useQuery({
    queryKey: [...ROUTING_KEY, "capabilities"],
    queryFn: api.listCapabilityOverrides,
  });
}

export function useReplaceCapabilityOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (overrides: AiCapabilityOverride[]) =>
      api.replaceCapabilityOverrides(overrides),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROUTING_KEY });
      toast.success("Capability notes saved");
    },
    onError: () => toast.error("Could not save the capability notes"),
  });
}

export function useUsageSummary(days = 30) {
  return useQuery({
    queryKey: [...ROUTING_KEY, "usage", days],
    queryFn: () => api.getUsageSummary(days),
  });
}

export function useProviderHealth(limit = 20) {
  return useQuery({
    queryKey: [...ROUTING_KEY, "health", limit],
    queryFn: () => api.getProviderHealth(limit),
  });
}

/**
 * The model pinned for one conversation, if any. The composer uses this to show
 * whether the conversation overrides the global default. `null` means "no
 * override", which is distinct from "loading" (the query's `isPending`).
 */
export function useConversationPreference(conversationId: string | null) {
  return useQuery({
    queryKey: [...ROUTING_KEY, "conversation", conversationId],
    queryFn: () => api.getConversationPreference(conversationId as string),
    enabled: Boolean(conversationId),
  });
}

export function useSetConversationPreference(conversationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider: string | null; model: string | null; connectionId?: string | null }) =>
      api.setConversationPreference(conversationId as string, input),
    onSuccess: (pref: AiModelPreference | null) => {
      qc.setQueryData([...ROUTING_KEY, "conversation", conversationId], pref);
      toast.success(pref ? "Model pinned for this conversation" : "Conversation now follows your default");
    },
    onError: () => toast.error("Could not change the model for this conversation"),
  });
}

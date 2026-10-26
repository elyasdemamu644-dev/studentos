import { api } from "@/lib/api/client";
import type {
  AiCatalogProvider,
  AiCapabilityOverride,
  AiModelPreference,
  AiModelPreferenceInput,
  AiProviderHealth,
  AiRoutingPolicy,
  AiRoutingPolicyUpdate,
  AiUsageSummary,
} from "@/types/api-types";

// ─────────────────────────────────────────────────────────────────────────────
// Routing API client
// ─────────────────────────────────────────────────────────────────────────────
//
// Thin wrappers over the owner-scoped routing endpoints. The user id always
// comes from the bearer token server-side, so nothing here passes an identity.

export function getRoutingPolicy(): Promise<AiRoutingPolicy> {
  return api.get<AiRoutingPolicy>("/ai/routing");
}

export function updateRoutingPolicy(input: AiRoutingPolicyUpdate): Promise<AiRoutingPolicy> {
  return api.patch<AiRoutingPolicy>("/ai/routing", input);
}

export function getRoutingCatalog(): Promise<AiCatalogProvider[]> {
  return api.get<AiCatalogProvider[]>("/ai/routing/catalog");
}

export function listGlobalPreferences(): Promise<AiModelPreference[]> {
  return api.get<AiModelPreference[]>("/ai/routing/preferences");
}

export function replaceGlobalPreferences(
  preferences: AiModelPreferenceInput[],
): Promise<AiModelPreference[]> {
  return api.put<AiModelPreference[]>("/ai/routing/preferences", { preferences });
}

export function listCapabilityOverrides(): Promise<AiCapabilityOverride[]> {
  return api.get<AiCapabilityOverride[]>("/ai/routing/capabilities");
}

export function replaceCapabilityOverrides(
  overrides: AiCapabilityOverride[],
): Promise<AiCapabilityOverride[]> {
  return api.put<AiCapabilityOverride[]>("/ai/routing/capabilities", { overrides });
}

export function getConversationPreference(conversationId: string): Promise<AiModelPreference | null> {
  return api.get<AiModelPreference | null>(
    `/ai/routing/conversations/${conversationId}/preference`,
  );
}

export function setConversationPreference(
  conversationId: string,
  input: { provider: string | null; model: string | null; connectionId?: string | null },
): Promise<AiModelPreference | null> {
  return api.put<AiModelPreference | null>(
    `/ai/routing/conversations/${conversationId}/preference`,
    input,
  );
}

export function getUsageSummary(days = 30): Promise<AiUsageSummary> {
  return api.get<AiUsageSummary>(`/ai/routing/usage?days=${days}`);
}

export function getProviderHealth(limit = 20): Promise<AiProviderHealth[]> {
  return api.get<AiProviderHealth[]>(`/ai/routing/health?limit=${limit}`);
}

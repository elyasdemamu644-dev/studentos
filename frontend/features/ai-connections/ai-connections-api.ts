import { api } from "@/lib/api/client";
import type { AiConnection, AiConnectionTestResult, AiMode, AiProviderName, ExecutionAutonomyMode, Page } from "@/types/api-types";

export interface AiConnectionListParams {
  limit?: number;
  cursor?: string;
}

export interface AiProviderSelection {
  mode: "default" | "personal";
  defaultAvailable: boolean;
  defaultProvider: string;
  defaultModel: string;
  personalConnectionAvailable: boolean;
  /** Behaviour mode the assistant runs turns in; defaults to AUTO. */
  aiMode: AiMode;
  /** The student's Default AI model preference, or null for the server default. */
  model: string | null;
  /** Execution autonomy mode: "manual" (default) or "autonomous". */
  executionAutonomyMode: ExecutionAutonomyMode;
}

export function getProviderSelection(): Promise<AiProviderSelection> {
  return api.get<AiProviderSelection>("/ai/provider-selection");
}

export interface AiModelOption {
  id: string;
  label: string;
}

export interface AiModelGroup {
  provider: AiProviderName;
  defaultModel: string;
  models: AiModelOption[];
}

export interface AiModelsResponse {
  defaultProvider: AiProviderName;
  defaultModel: string;
  group: AiModelGroup;
}

/** The selectable models for the Default AI, from a static server catalog. */
export function listDefaultAiModels(): Promise<AiModelsResponse> {
  return api.get<AiModelsResponse>("/ai/models");
}

export function setProviderMode(mode: AiProviderSelection["mode"]): Promise<Record<string, string | null>> {
  return api.patch<Record<string, string | null>>("/settings", {
    settings: { "ai.providerMode": mode },
  });
}

/** Persist the assistant behaviour mode. A null value restores the AUTO default. */
export function setAiMode(mode: AiMode | null): Promise<Record<string, string | null>> {
  return api.patch<Record<string, string | null>>("/settings", {
    settings: { "ai.mode": mode },
  });
}

/** Persist the execution autonomy mode. A null value restores the manual default. */
export function setExecutionAutonomyMode(mode: ExecutionAutonomyMode | null): Promise<Record<string, string | null>> {
  return api.patch<Record<string, string | null>>("/settings", {
    settings: { "ai.executionMode": mode },
  });
}

/** Persist the Default AI model. A null value restores the server default. */
export function setDefaultModel(model: string | null): Promise<Record<string, string | null>> {
  return api.patch<Record<string, string | null>>("/settings", {
    settings: { "ai.model": model && model.trim() ? model.trim() : null },
  });
}

export function listConnections(params: AiConnectionListParams = {}): Promise<Page<AiConnection>> {
  const query = new URLSearchParams();
  const entries = params as Record<string, string | number | undefined>;
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return api.get<Page<AiConnection>>(qs ? `/ai-connections?${qs}` : "/ai-connections");
}

export interface CreateConnectionInput {
  provider: AiProviderName;
  model?: string | null;
  endpoint?: string | null;
  // A bare key string is accepted directly by the API's credential parser; it
  // treats a non-JSON value as the API key itself. Only credential-free
  // providers (ollama) may omit this.
  credentials?: string;
}

export function createConnection(input: CreateConnectionInput): Promise<AiConnection> {
  return api.post<AiConnection>("/ai-connections", input);
}

export interface UpdateConnectionInput {
  model?: string | null;
  endpoint?: string | null;
  credentials?: string;
  enabled?: boolean;
  isActive?: boolean;
}

export function updateConnection(id: string, input: UpdateConnectionInput): Promise<AiConnection> {
  return api.patch<AiConnection>(`/ai-connections/${id}`, input);
}

export function deleteConnection(id: string): Promise<void> {
  return api.delete<void>(`/ai-connections/${id}`);
}

export function activateConnection(id: string): Promise<AiConnection> {
  return api.post<AiConnection>(`/ai-connections/${id}/activate`, {});
}

// ── Connectivity test ─────────────────────────────

/**
 * Ad-hoc test of credentials that have not been saved yet. Credential-free
 * providers may omit `credentials`.
 */
export function testConnection(input: CreateConnectionInput): Promise<AiConnectionTestResult> {
  return api.post<AiConnectionTestResult>("/ai-connections/test", input);
}

/** Test a saved connection, reusing its stored (server-side) credentials. */
export function testSavedConnection(id: string): Promise<AiConnectionTestResult> {
  return api.post<AiConnectionTestResult>(`/ai-connections/${id}/test`, {});
}

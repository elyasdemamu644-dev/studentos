import { api } from "@/lib/api/client";
import type { AiConnection, AiConnectionTestResult, AiProviderName, Page } from "@/types/api-types";

export interface AiConnectionListParams {
  limit?: number;
  cursor?: string;
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

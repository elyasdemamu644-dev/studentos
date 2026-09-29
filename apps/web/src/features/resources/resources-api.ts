import { api } from "@/lib/api/client";
import type { Page, ResourceRecord, ResourceType } from "@/types/api-types";

export interface ResourceListParams {
  courseId?: string;
  resourceType?: ResourceType;
  search?: string;
  limit?: number;
  cursor?: string;
}

export function listResources(params: ResourceListParams = {}): Promise<Page<ResourceRecord>> {
  const query = new URLSearchParams();
  const entries = params as Record<string, string | number | undefined>;
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return api.get<Page<ResourceRecord>>(qs ? `/resources?${qs}` : "/resources");
}

export function getResource(id: string): Promise<ResourceRecord> {
  return api.get<ResourceRecord>(`/resources/${id}`);
}

export interface CreateResourceInput {
  title: string;
  description?: string | null;
  courseId?: string | null;
  /** Only `URL` storage is creatable today; uploads arrive with the S3 phase. */
  storageType?: "URL";
  url: string;
  resourceType?: ResourceType;
}

export function createResource(input: CreateResourceInput): Promise<ResourceRecord> {
  return api.post<ResourceRecord>("/resources", input);
}

export interface UpdateResourceInput {
  title?: string;
  description?: string | null;
  courseId?: string | null;
  url?: string;
  resourceType?: ResourceType;
}

export function updateResource(
  id: string,
  input: UpdateResourceInput,
): Promise<ResourceRecord> {
  return api.patch<ResourceRecord>(`/resources/${id}`, input);
}

export function deleteResource(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/resources/${id}`);
}

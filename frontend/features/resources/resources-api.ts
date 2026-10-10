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

export interface UploadResourceInput {
  file: File;
  title: string;
  description?: string | null;
  courseId?: string | null;
  /** Omit to let the server infer the type from the file's content. */
  resourceType?: ResourceType;
}

/**
 * Upload a file as a multipart resource. The `file` part name and the optional
 * metadata field names mirror `uploadResourceFieldsSchema` on the API; the
 * client never sets the multipart Content-Type (the browser adds the boundary).
 */
export function uploadResource(input: UploadResourceInput): Promise<ResourceRecord> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("title", input.title);
  if (input.description) form.append("description", input.description);
  if (input.courseId) form.append("courseId", input.courseId);
  if (input.resourceType) form.append("resourceType", input.resourceType);
  return api.upload<ResourceRecord>("/resources/upload", form);
}

/**
 * Fetch an uploaded resource's bytes through the authenticated API. The
 * response is the raw file, not the JSON envelope, so this bypasses the normal
 * JSON transport. Returns the blob and the server's filename, if any.
 */
export function downloadResource(
  id: string,
): Promise<{ blob: Blob; fileName: string | null }> {
  return api.download(`/resources/${id}/download`);
}

export interface CreateResourceInput {
  title: string;
  description?: string | null;
  courseId?: string | null;
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

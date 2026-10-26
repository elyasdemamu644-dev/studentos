"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ResourceProgress, ResourceRecord } from "@/types/api-types";
import * as api from "./resources-api";

export function useResources(params: api.ResourceListParams = {}) {
  return useQuery({
    queryKey: ["resources", params],
    queryFn: () => api.listResources(params),
  });
}

export function useResource(id: string | undefined) {
  return useQuery({
    queryKey: ["resources", id],
    queryFn: () => api.getResource(id!),
    enabled: Boolean(id),
  });
}

export function useCreateResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateResourceInput) => api.createResource(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resources"] });
      qc.invalidateQueries({ queryKey: ["course-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Resource added");
    },
    onError: () => toast.error("Could not add the resource"),
  });
}

export function useUploadResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.UploadResourceInput) => api.uploadResource(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resources"] });
      qc.invalidateQueries({ queryKey: ["course-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Material uploaded");
    },
    // The server's message is the useful one ("The uploaded file is too large",
    // "This file type is not allowed…"), so surface it rather than a generic.
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not upload the file"),
  });
}

export function useUpdateResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.UpdateResourceInput }) =>
      api.updateResource(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resources"] });
      qc.invalidateQueries({ queryKey: ["course-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Resource saved");
    },
    onError: () => toast.error("Could not save the resource"),
  });
}

export function useDeleteResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteResource(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resources"] });
      qc.invalidateQueries({ queryKey: ["course-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Resource removed");
    },
    onError: () => toast.error("Could not remove the resource"),
  });
}

/**
 * Fetch an uploaded file's bytes. The caller saves the returned blob (the hook
 * has no DOM side effects so it stays usable outside the browser); the server's
 * filename is preferred, with the record's own name as a fallback.
 */
export function useDownloadResource() {
  return useMutation({
    mutationFn: (resource: Pick<ResourceRecord, "id" | "fileName" | "title">) =>
      api.downloadResource(resource.id),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not download the file"),
  });
}

export function useResourceContent(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["resource-content", id],
    queryFn: () => api.fetchResourceContent(id!),
    enabled: Boolean(id) && enabled,
    staleTime: 5 * 60_000,
  });
}

export function useResourceTextStatus(id: string | undefined) {
  return useQuery({
    queryKey: ["resource-text", id],
    queryFn: () => api.fetchResourceTextStatus(id!),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });
}

export function useResourceLinkPreview(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["resource-link-preview", id],
    queryFn: () => api.fetchResourceLinkPreview(id!),
    enabled: Boolean(id) && enabled,
    staleTime: 2 * 60_000,
    retry: false,
  });
}

export function useResourceProgress(id: string | undefined) {
  return useQuery({
    queryKey: ["resource-progress", id],
    queryFn: () => api.fetchResourceProgress(id!),
    enabled: Boolean(id),
  });
}

export function useSaveResourceProgress(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Omit<ResourceProgress, "updatedAt">>) =>
      api.saveResourceProgress(id, input),
    onSuccess: (data) => {
      qc.setQueryData(["resource-progress", id], data);
    },
    // Progress saves are background/non-blocking. A transient failure should
    // not interrupt reading with a toast; the next position change retries.
    onError: () => undefined,
  });
}

export function useResourceBookmarks(id: string | undefined) {
  return useQuery({
    queryKey: ["resource-bookmarks", id],
    queryFn: () => api.listResourceBookmarks(id!),
    enabled: Boolean(id),
  });
}

export function useCreateResourceBookmark(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateBookmarkInput) => api.createResourceBookmark(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resource-bookmarks", id] });
      toast.success("Bookmark saved");
    },
    onError: () => toast.error("Could not save the bookmark"),
  });
}

export function useDeleteResourceBookmark(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookmarkId: string) => api.deleteResourceBookmark(id, bookmarkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resource-bookmarks", id] });
    },
    onError: () => toast.error("Could not remove the bookmark"),
  });
}

export type { ResourceRecord };

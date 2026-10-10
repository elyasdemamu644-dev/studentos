"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ResourceRecord } from "@/types/api-types";
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

export type { ResourceRecord };

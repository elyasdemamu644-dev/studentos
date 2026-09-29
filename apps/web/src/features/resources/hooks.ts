"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as api from "./resources-api";

export function useResources(params: api.ResourceListParams = {}) {
  return useQuery({
    queryKey: ["resources", params],
    queryFn: () => api.listResources(params),
  });
}

export function useCreateResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateResourceInput) => api.createResource(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resources"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Resource added");
    },
    onError: () => toast.error("Could not add the resource"),
  });
}

export function useUpdateResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.UpdateResourceInput }) =>
      api.updateResource(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resources"] });
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
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Resource removed");
    },
    onError: () => toast.error("Could not remove the resource"),
  });
}

export type { ResourceRecord } from "@/types/api-types";

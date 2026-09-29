"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { GradeRecord } from "@/types/api-types";
import * as api from "./grades-api";

export function useGrades(params: api.GradeListParams = {}) {
  return useQuery({
    queryKey: ["grades", params],
    queryFn: () => api.listGrades(params),
  });
}

export function useCreateGrade(onSuccess?: (grade: GradeRecord) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateGradeInput) => api.createGrade(input),
    onSuccess: (grade) => {
      qc.invalidateQueries({ queryKey: ["grades"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Grade recorded");
      onSuccess?.(grade);
    },
    onError: () => toast.error("Could not record the grade"),
  });
}

export function useUpdateGrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.UpdateGradeInput }) =>
      api.updateGrade(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grades"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Grade updated");
    },
    onError: () => toast.error("Could not update the grade"),
  });
}

export function useDeleteGrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteGrade(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["grades"] });
      qc.removeQueries({ queryKey: ["grades", id] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Grade deleted");
    },
    onError: () => toast.error("Could not delete the grade"),
  });
}

export type { GradeRecord } from "@/types/api-types";
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AcademicYear, Course, Semester } from "@/features/api-types";
import * as api from "./courses-api";

export function useSemesters() {
  return useQuery({
    queryKey: ["semesters"],
    queryFn: api.listSemesters,
  });
}

export function useAcademicYears() {
  return useQuery({
    queryKey: ["academic-years"],
    queryFn: api.listAcademicYears,
  });
}

export function useCourses(params: api.CourseListParams = {}) {
  return useQuery({
    queryKey: ["courses", params],
    queryFn: () => api.listCourses(params),
  });
}

export function useCourse(id: string | undefined) {
  return useQuery({
    queryKey: ["courses", id],
    queryFn: () => api.getCourse(id!),
    enabled: Boolean(id),
  });
}

export function useCreateCourse(onSuccess?: (course: Course) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateCourseInput) => api.createCourse(input),
    onSuccess: (course) => {
      qc.invalidateQueries({ queryKey: ["courses"] });
      toast.success(`Course "${course.name}" created`);
      onSuccess?.(course);
    },
    onError: () => toast.error("Could not create the course"),
  });
}

export function useUpdateCourse(onSuccess?: (course: Course) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.UpdateCourseInput }) =>
      api.updateCourse(id, input),
    onSuccess: (course) => {
      qc.invalidateQueries({ queryKey: ["courses"] });
      toast.success("Course updated");
      onSuccess?.(course);
    },
    onError: () => toast.error("Could not update the course"),
  });
}

export function useDeleteCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCourse(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["courses"] });
      qc.removeQueries({ queryKey: ["courses", id] });
      toast.success("Course deleted");
    },
    onError: () => toast.error("Could not delete the course — it may still have linked data"),
  });
}

export function useCreateAcademicYear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateAcademicYearInput) => api.createAcademicYear(input),
    onSuccess: (year: AcademicYear) => {
      qc.invalidateQueries({ queryKey: ["academic-years"] });
      toast.success(`Academic year "${year.name}" created`);
    },
    onError: () => toast.error("Could not create the academic year"),
  });
}

export function useCreateSemester() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateSemesterInput) => api.createSemester(input),
    onSuccess: (semester: Semester) => {
      qc.invalidateQueries({ queryKey: ["semesters"] });
      toast.success(`Semester "${semester.name}" created`);
    },
    onError: () => toast.error("Could not create the semester"),
  });
}
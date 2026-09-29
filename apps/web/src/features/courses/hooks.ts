"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AcademicYear, Course, Semester } from "@/types/api-types";
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

/**
 * Single cross-system rollup for a course. Preferred over fanning out to every
 * module endpoint, which produced N round-trips and inconsistent aggregates.
 */
export function useCourseSummary(id: string | undefined) {
  return useQuery({
    queryKey: ["course-summary", id],
    queryFn: () => api.getCourseSummary(id!),
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
      // The dashboard reports the current academic year, so it must refresh too.
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Academic year "${year.name}" created`);
    },
    onError: () => toast.error("Could not create the academic year"),
  });
}

export function useUpdateAcademicYear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.UpdateAcademicYearInput }) =>
      api.updateAcademicYear(id, input),
    onSuccess: (year: AcademicYear) => {
      qc.invalidateQueries({ queryKey: ["academic-years"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Academic year "${year.name}" updated`);
    },
    onError: () => toast.error("Could not update the academic year"),
  });
}

export function useDeleteAcademicYear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAcademicYear(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["academic-years"] });
      qc.invalidateQueries({ queryKey: ["semesters"] });
      qc.invalidateQueries({ queryKey: ["courses"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.removeQueries({ queryKey: ["academic-years", id] });
      toast.success("Academic year deleted");
    },
    onError: () => toast.error("Could not delete the academic year — it may still have linked data"),
  });
}

export function useCreateSemester() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateSemesterInput) => api.createSemester(input),
    onSuccess: (semester: Semester) => {
      qc.invalidateQueries({ queryKey: ["semesters"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Semester "${semester.name}" created`);
    },
    onError: () => toast.error("Could not create the semester"),
  });
}

export function useUpdateSemester() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.UpdateSemesterInput }) =>
      api.updateSemester(id, input),
    onSuccess: (semester: Semester) => {
      qc.invalidateQueries({ queryKey: ["semesters"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Semester "${semester.name}" updated`);
    },
    onError: () => toast.error("Could not update the semester"),
  });
}

export function useDeleteSemester() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSemester(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["semesters"] });
      qc.invalidateQueries({ queryKey: ["courses"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.removeQueries({ queryKey: ["semesters", id] });
      toast.success("Semester deleted");
    },
    onError: () => toast.error("Could not delete the semester — it may still have linked data"),
  });
}
import { api } from "@/lib/api/client";
import type {
  AcademicYear,
  Course,
  CourseStatus,
  CourseSummary,
  Semester,
  YearStatus,
} from "@/types/api-types";

// ── Academics ─────────────────────────────────────

export function listAcademicYears(): Promise<AcademicYear[]> {
  return api.get<AcademicYear[]>("/academics/academic-years");
}

export function listSemesters(): Promise<Semester[]> {
  return api.get<Semester[]>("/academics/semesters");
}

export interface CreateAcademicYearInput {
  name: string;
  startDate: string;
  endDate: string;
  status?: YearStatus;
}

export function createAcademicYear(input: CreateAcademicYearInput): Promise<AcademicYear> {
  return api.post<AcademicYear>("/academics/academic-years", input);
}

export interface UpdateAcademicYearInput {
  name?: string;
  startDate?: string;
  endDate?: string;
  status?: YearStatus;
}

export function updateAcademicYear(id: string, input: UpdateAcademicYearInput): Promise<AcademicYear> {
  return api.patch<AcademicYear>(`/academics/academic-years/${id}`, input);
}

export function deleteAcademicYear(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/academics/academic-years/${id}`);
}

export interface CreateSemesterInput {
  academicYearId: string;
  name: string;
  startDate: string;
  endDate: string;
  status?: YearStatus;
}

export function createSemester(input: CreateSemesterInput): Promise<Semester> {
  return api.post<Semester>("/academics/semesters", input);
}

export interface UpdateSemesterInput {
  name?: string;
  startDate?: string;
  endDate?: string;
  status?: YearStatus;
}

export function updateSemester(id: string, input: UpdateSemesterInput): Promise<Semester> {
  return api.patch<Semester>(`/academics/semesters/${id}`, input);
}

export function deleteSemester(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/academics/semesters/${id}`);
}

// ── Courses ───────────────────────────────────────

export interface CourseListParams {
  search?: string;
  status?: CourseStatus;
  semesterId?: string;
  limit?: number;
  cursor?: string;
}

export function listCourses(params: CourseListParams = {}): Promise<Course[]> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.semesterId) query.set("semesterId", params.semesterId);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  const qs = query.toString();
  return api.get<Course[]>(qs ? `/courses?${qs}` : "/courses");
}

export function getCourse(id: string): Promise<Course> {
  return api.get<Course>(`/courses/${id}`);
}

export function getCourseSummary(id: string): Promise<CourseSummary> {
  return api.get<CourseSummary>(`/courses/${id}/summary`);
}

export interface CreateCourseInput {
  name: string;
  code?: string | null;
  description?: string | null;
  credits?: number | null;
  semesterId?: string | null;
  instructor?: string | null;
}

export function createCourse(input: CreateCourseInput): Promise<Course> {
  return api.post<Course>("/courses", input);
}

export interface UpdateCourseInput {
  name?: string;
  code?: string | null;
  description?: string | null;
  credits?: number | null;
  semesterId?: string | null;
  instructor?: string | null;
  status?: CourseStatus;
}

export function updateCourse(id: string, input: UpdateCourseInput): Promise<Course> {
  return api.patch<Course>(`/courses/${id}`, input);
}

export function deleteCourse(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/courses/${id}`);
}

// Deterministic hue per course id for warm, varied swatches.
export function courseHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export function courseColor(id: string): string {
  return `hsl(${courseHue(id)} 62% 45%)`;
}

export function courseColorSoft(id: string): string {
  return `hsl(${courseHue(id)} 60% 92%)`;
}

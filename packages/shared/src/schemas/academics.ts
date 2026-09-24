import { z } from "zod";

// ─────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────

export const idSchema = z.string().cuid("Invalid id format");
export const dateSchema = z.coerce.date({ message: "Invalid date" });
export const optionalDateSchema = z.coerce.date({ message: "Invalid date" }).nullable().optional();

// ─────────────────────────────────────────────
// ACADEMIC YEAR
// ─────────────────────────────────────────────

export const academicYearStatusSchema = z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]);

export const academicYearSchema = z.object({
  id: idSchema,
  userId: idSchema,
  name: z.string().trim(),
  startDate: dateSchema,
  endDate: dateSchema,
  status: academicYearStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createAcademicYearSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  startDate: dateSchema,
  endDate: dateSchema,
  status: academicYearStatusSchema.optional(),
});

export const updateAcademicYearSchema = createAcademicYearSchema.partial();

// ─────────────────────────────────────────────
// SEMESTER
// ─────────────────────────────────────────────

export const semesterStatusSchema = z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]);

export const semesterSchema = z.object({
  id: idSchema,
  academicYearId: idSchema,
  name: z.string().trim(),
  startDate: dateSchema,
  endDate: dateSchema,
  status: semesterStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  // optional parent
  academicYear: academicYearSchema.optional(),
});

export const createSemesterSchema = z.object({
  academicYearId: idSchema,
  name: z.string().trim().min(1, "Name is required"),
  startDate: dateSchema,
  endDate: dateSchema,
  status: semesterStatusSchema.optional(),
});

export const updateSemesterSchema = createSemesterSchema.partial();

// ─────────────────────────────────────────────
// COURSE
// ─────────────────────────────────────────────

export const courseStatusSchema = z.enum(["ACTIVE", "COMPLETED", "DROPPED"]);

export const courseSchema = z.object({
  id: idSchema,
  userId: idSchema,
  semesterId: idSchema.nullable(),
  name: z.string().trim(),
  code: z.string().trim().nullable(),
  description: z.string().nullable(),
  instructor: z.string().trim().nullable(),
  credits: z.number().int().nullable(),
  color: z.string().default("#6366f1"),
  status: courseStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  // optional relations for convenience
  semester: semesterSchema.optional(),
});

export const createCourseSchema = z.object({
  semesterId: idSchema.nullable().optional(),
  name: z.string().trim().min(1, "Course name is required"),
  code: z.string().trim().nullable().optional(),
  description: z.string().trim().nullable().optional(),
  instructor: z.string().trim().nullable().optional(),
  credits: z.number().int().min(0).nullable().optional(),
  color: z.string().optional(),
  status: courseStatusSchema.optional(),
});

export const updateCourseSchema = createCourseSchema.partial();

// ─────────────────────────────────────────────
// DERIVED TYPES
// ─────────────────────────────────────────────

export type AcademicYearStatus = z.infer<typeof academicYearStatusSchema>;
export type AcademicYear = z.infer<typeof academicYearSchema>;
export type CreateAcademicYearInput = z.infer<typeof createAcademicYearSchema>;
export type UpdateAcademicYearInput = z.infer<typeof updateAcademicYearSchema>;

export type SemesterStatus = z.infer<typeof semesterStatusSchema>;
export type Semester = z.infer<typeof semesterSchema>;
export type CreateSemesterInput = z.infer<typeof createSemesterSchema>;
export type UpdateSemesterInput = z.infer<typeof updateSemesterSchema>;

export type CourseStatus = z.infer<typeof courseStatusSchema>;
export type Course = z.infer<typeof courseSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;

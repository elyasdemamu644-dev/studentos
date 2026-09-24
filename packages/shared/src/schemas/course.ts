// ─────────────────────────────────────────────
// COURSE
// ─────────────────────────────────────────────
import { z } from "zod";
import { idSchema } from "./academics";

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
  semester: z.any().optional(),
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

// Derived types
export type CourseStatus = z.infer<typeof courseStatusSchema>;
export type Course = z.infer<typeof courseSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
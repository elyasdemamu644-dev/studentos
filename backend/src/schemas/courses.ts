import { z } from "zod";

/**
 * Course request/response schemas.
 *
 * These mirror the OpenAPI spec and the Prisma model in
 * `backend/prisma/schema.prisma`.
 */

// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────

export const idSchema = z
  .string()
  .min(1, "ID is required")
  .refine((v) => v.length >= 1 && v.length <= 26 && /^[a-zA-Z0-9-]+$/.test(v), "ID must be 1-26 alphanumeric characters (dashes allowed)");

// ─────────────────────────────────────────────
// Course code — uppercase alphanumeric with optional dash/dot (e.g. "SE-204", "CS 101")
// ─────────────────────────────────────────────

export const courseCodeSchema = z
  .string()
  .min(1, "Course code is required")
  .max(20)
  .regex(/^[A-Za-z0-9][A-Za-z0-9\s\-\.]*/);

// ─────────────────────────────────────────────
// Course
// ─────────────────────────────────────────────

export const courseSchema = z.object({
  id: idSchema,
  code: courseCodeSchema,
  name: z.string().min(1).max(200),
  credits: z.number().int().min(0).max(50),
  description: z.string().max(2000).optional(),
  semesterId: idSchema,
  status: z.enum(["ACTIVE", "COMPLETED", "DROPPED"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const courseWithSemesterSchema = courseSchema.extend({
  semester: z.object({
    id: idSchema,
    name: z.string(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]),
    isCurrent: z.boolean(),
    academicYear: z.object({
      id: idSchema,
      name: z.string(),
      startDate: z.string().datetime(),
      endDate: z.string().datetime(),
      status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]),
    }),
  }),
});

// ─────────────────────────────────────────────
// Create / update
// ─────────────────────────────────────────────

export const courseCreateSchema = z.object({
  code: courseCodeSchema.nullable().optional(),
  name: z.string().min(1).max(200),
  credits: z.number().int().min(0).max(50).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  instructor: z.string().max(200).nullable().optional(),
  semesterId: idSchema.nullable().optional(),
});

export const courseUpdateSchema = z.object({
  code: courseCodeSchema.optional(),
  name: z.string().min(1).max(200).optional(),
  credits: z.number().int().min(0).max(50).optional(),
  description: z.string().max(2000).optional().nullable(),
  instructor: z.string().max(200).nullable().optional(),
  semesterId: idSchema.optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "DROPPED"]).optional(),
});

// ─────────────────────────────────────────────
// List query
// ─────────────────────────────────────────────

export const courseListQuerySchema = z.object({
  semesterId: idSchema.optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "DROPPED"]).optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: idSchema.optional(),
});

// ─────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────

export type Course = z.infer<typeof courseSchema>;
export type CourseWithSemester = z.infer<typeof courseWithSemesterSchema>;
export type CourseCreate = z.infer<typeof courseCreateSchema>;
export type CourseUpdate = z.infer<typeof courseUpdateSchema>;
export type CourseListQuery = z.infer<typeof courseListQuerySchema>;
